#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

mkdir -p docs/book/dist

tmpdir="$(mktemp -d "${TMPDIR:-/data/data/com.termux/files/usr/tmp}/omnighost-book.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

version="$(node -p "require('./package.json').version")"
if [[ -z "$version" ]]; then
  echo "could not read version from package.json" >&2
  exit 1
fi

title_stem="$(
  awk -F: '
    $1 ~ /^[[:space:]]*title_stem[[:space:]]*$/ {
      value = $2
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      gsub(/^["'\''"]|["'\''"]$/, "", value)
      print value
      exit
    }
  ' docs/book/metadata.yaml
)"
if [[ -z "$title_stem" ]]; then
  title_stem="obsidian"
fi
base_stem="$title_stem"
case "$base_stem" in
  *-typst) base_stem="${base_stem%-typst}" ;;
  *-troff) base_stem="${base_stem%-troff}" ;;
esac
typst_stem="$base_stem-typst"
troff_stem="$base_stem-troff"

pubdate="$(date -u +%F)"
githash="$(git rev-parse --short=6 HEAD 2>/dev/null || echo nogit)"
version_stamp="$version-$githash"
kindle_name_typst="$typst_stem ($version)"
kindle_name_troff="$troff_stem ($version)"
link_stem_typst="$typst_stem ($version_stamp)"
link_stem_troff="$troff_stem ($version_stamp)"

docs/book/render-diagrams.sh

{
  printf 'version_stamp: %s\n' "$version_stamp"
  printf 'built_at: %s\n' "$pubdate"
  printf 'kindle_name_typst: %s\n' "$kindle_name_typst"
  printf 'epub_file_typst: %s.epub\n' "$typst_stem"
  printf 'pdf_file_typst: %s.pdf\n' "$typst_stem"
  printf 'epub_link_typst: %s.epub\n' "$link_stem_typst"
  printf 'pdf_link_typst: %s.pdf\n' "$link_stem_typst"
  printf 'kindle_name_troff: %s\n' "$kindle_name_troff"
  printf 'epub_file_troff: %s.epub\n' "$troff_stem"
  printf 'pdf_file_troff: %s.pdf\n' "$troff_stem"
  printf 'epub_link_troff: %s.epub\n' "$link_stem_troff"
  printf 'pdf_link_troff: %s.pdf\n' "$link_stem_troff"
} > docs/book/dist/VERSION.md

extract_raw_block() {
  local format="$1"
  local source="$2"
  local output="$3"

  awk -v format="$format" '
    $0 == "```{=" format "}" { in_block = 1; next }
    in_block && /^```$/ { exit }
    in_block { print }
  ' "$source" > "$output"
}

# Re-embed any unembedded fonts (groff -P-e silently fails when its devpdf
# "download" map is stale, e.g. after a ghostscript upgrade). Ghostscript
# substitutes metrically-compatible URW fonts for the base 14 and embeds
# them; without embedding, readers substitute fonts with different metrics
# and word spacing renders wrong (gaps too wide or missing).
embed_pdf_fonts() {
  local pdf="$1"
  if command -v gs >/dev/null 2>&1; then
    local tmp="$tmpdir/$(basename "$pdf" .pdf)-embedded.pdf"
    if gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite \
        -dEmbedAllFonts=true -dSubsetFonts=true \
        -o "$tmp" -c '<</NeverEmbed []>> setdistillerparams' -f "$pdf"; then
      mv "$tmp" "$pdf"
    fi
  fi
  if command -v pdffonts >/dev/null 2>&1; then
    if ! pdffonts "$pdf" | awk 'NR>2 && $(NF-4)=="no" { bad=1 } END { exit bad }'; then
      echo "WARNING: $pdf has unembedded fonts — word spacing will render wrong in most readers" >&2
    fi
  fi
}

build_typst_pdf() {
  local stem="$1"
  local kindle_name="$2"
  local cover_md="$tmpdir/$stem-cover.md"
  local cover_typ="$tmpdir/$stem-cover.typ"
  local cover_pdf="$tmpdir/$stem-cover.pdf"
  local body_pdf="$tmpdir/$stem-body.pdf"

  sed "s/{{KINDLE_NAME}}/$kindle_name/g" docs/book/cover.md > "$cover_md"
  extract_raw_block typst "$cover_md" "$cover_typ"
  typst compile "$cover_typ" "$cover_pdf"

  pandoc docs/book/omnighost.md \
    -o "$body_pdf" \
    --pdf-engine=typst \
    --toc \
    --number-sections

  pdfunite "$cover_pdf" "$body_pdf" "docs/book/dist/$stem.pdf"
}

build_troff_pdf() {
  local stem="$1"
  local kindle_name="$2"
  local cover_md="$tmpdir/$stem-cover.md"
  local cover_ms="$tmpdir/$stem-cover.ms"
  local cover_pdf="$tmpdir/$stem-cover.pdf"
  local body_ms="$tmpdir/$stem-body.ms"
  local body_pdf="$tmpdir/$stem-body.pdf"

  sed "s/{{KINDLE_NAME}}/$kindle_name/g" docs/book/cover.md > "$cover_md"
  extract_raw_block ms "$cover_md" "$cover_ms"
  # -t: tbl preprocessor (pandoc emits .TS/.TE tables); -P-e: embed fonts in
  # the PDF — without embedding, readers substitute fonts with different
  # metrics and word spacing breaks (gaps too wide or missing).
  groff -Tpdf -P-e -t -ms "$cover_ms" > "$cover_pdf"

  pandoc docs/book/omnighost.md \
    -o "$body_ms" \
    -t ms \
    -s \
    --toc \
    --number-sections

  groff -Tpdf -P-e -t -ms "$body_ms" > "$body_pdf"
  pdfunite "$cover_pdf" "$body_pdf" "docs/book/dist/$stem.pdf"
  embed_pdf_fonts "docs/book/dist/$stem.pdf"
}

build_epub() {
  local stem="$1"
  local kindle_name="$2"
  local cover_md="$tmpdir/$stem-cover.md"
  local stable_epub="docs/book/dist/$stem.epub"

  sed "s/{{KINDLE_NAME}}/$kindle_name/g" docs/book/cover.md > "$cover_md"
  pandoc "$cover_md" docs/book/omnighost.md \
    -o "$stable_epub" \
    --toc \
    --number-sections \
    --metadata-file docs/book/metadata.yaml \
    --metadata date="$pubdate" \
    --css docs/book/epub.css \
    --epub-title-page=false

  docs/book/fix_epub_layout.sh "$stable_epub" "$kindle_name"
}

find docs/book/dist -maxdepth 1 \
  \( -name "$typst_stem (*).epub" -o -name "$typst_stem (*).pdf" \
  -o -name "$troff_stem (*).epub" -o -name "$troff_stem (*).pdf" \) -delete

build_typst_pdf "$typst_stem" "$kindle_name_typst"
build_epub "$typst_stem" "$kindle_name_typst"
build_troff_pdf "$troff_stem" "$kindle_name_troff"
build_epub "$troff_stem" "$kindle_name_troff"

ln -s "$(basename "docs/book/dist/$typst_stem.epub")" "docs/book/dist/$link_stem_typst.epub"
ln -s "$(basename "docs/book/dist/$typst_stem.pdf")" "docs/book/dist/$link_stem_typst.pdf"
ln -s "$(basename "docs/book/dist/$troff_stem.epub")" "docs/book/dist/$link_stem_troff.epub"
ln -s "$(basename "docs/book/dist/$troff_stem.pdf")" "docs/book/dist/$link_stem_troff.pdf"

docs/book/check_epub_metadata.sh "docs/book/dist/$typst_stem.epub" "$kindle_name_typst"
docs/book/check_epub_metadata.sh "docs/book/dist/$troff_stem.epub" "$kindle_name_troff"

if command -v ebook-convert >/dev/null 2>&1; then
  ebook-convert "docs/book/dist/$typst_stem.epub" "docs/book/dist/$typst_stem.mobi"
  ebook-convert "docs/book/dist/$troff_stem.epub" "docs/book/dist/$troff_stem.mobi"
else
  echo "ebook-convert not found; skipped MOBI build" >&2
fi
