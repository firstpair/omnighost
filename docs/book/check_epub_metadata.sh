#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 path/to/book.epub [expected-title]" >&2
  exit 2
fi

epub="$1"
expected_title="${2:-omnighost}"
visible_title="Omnighost for First Pair Press"
cover_id="omnighost-for-first-pair-press"
epub_path="$(cd "$(dirname "$epub")" && pwd)/$(basename "$epub")"
dist_dir="$(dirname "$epub_path")"

if [[ ! -f "$epub" ]]; then
  echo "EPUB not found: $epub" >&2
  exit 2
fi

tmpdir="$(mktemp -d "${TMPDIR:-/data/data/com.termux/files/usr/tmp}/omnighost-epub-check.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

opf="$tmpdir/content.opf"
opf_flat="$tmpdir/content.flat"
toc="$tmpdir/toc.ncx"
toc_flat="$tmpdir/toc.flat"
nav="$tmpdir/nav.xhtml"
image_cover="$tmpdir/cover.xhtml"
cover="$tmpdir/ch001.xhtml"
stylesheet="$tmpdir/stylesheet1.css"
embedded_cover="$tmpdir/embedded-cover.png"
source_cover="$(cd "$(dirname "$0")" && pwd)/assets/omnighost-cover.png"

unzip -p "$epub" EPUB/content.opf > "$opf"
unzip -p "$epub" EPUB/toc.ncx > "$toc"
unzip -p "$epub" EPUB/nav.xhtml > "$nav"
unzip -p "$epub" EPUB/text/cover.xhtml > "$image_cover"
unzip -p "$epub" EPUB/text/ch001.xhtml > "$cover"
unzip -p "$epub" EPUB/styles/stylesheet1.css > "$stylesheet"
tr '\n\r\t' '   ' < "$opf" > "$opf_flat"
tr '\n\r\t' '   ' < "$toc" > "$toc_flat"

require_pattern() {
  local pattern="$1"
  local file="$2"
  local message="$3"

  if ! grep -Eq "$pattern" "$file"; then
    echo "EPUB metadata check failed: $message" >&2
    exit 1
  fi
}

reject_pattern() {
  local pattern="$1"
  local file="$2"
  local message="$3"

  if grep -Eq "$pattern" "$file"; then
    echo "EPUB metadata check failed: $message" >&2
    exit 1
  fi
}

regex_escape() {
  sed 's/[][(){}.^$*+?|\\]/\\&/g' <<< "$1"
}

expected_title_pattern="$(regex_escape "$expected_title")"
visible_title_pattern="$(regex_escape "$visible_title")"
expected_stem="omnighost"
stable_epub="$dist_dir/$expected_stem.epub"
version_marker="$dist_dir/VERSION.md"

require_pattern "<dc:title[^>]*>$expected_title_pattern</dc:title>" "$opf" "missing dc:title"
require_pattern "<meta[^>]*refines=\"#epub-title-1\"[^>]*property=\"file-as\"[^>]*>$expected_title_pattern</meta>" "$opf" "missing title sort metadata"
require_pattern '<dc:creator[^>]*>Alexy Khrabrov</dc:creator>' "$opf" "missing dc:creator"
require_pattern '<dc:language>en-US</dc:language>' "$opf" "missing dc:language"
require_pattern '<dc:date[^>]*>[0-9]{4}-[0-9]{2}-[0-9]{2}</dc:date>' "$opf" "missing dc:date"
require_pattern '<meta[^>]+property="dcterms:modified"' "$opf" "missing dcterms:modified"
require_pattern '<meta name="cover" content="[^ "]+" />' "$opf" "missing EPUB 2 cover metadata"
require_pattern '<item[^>]+properties="cover-image"[^>]+href="media/[^ "]+\.png"' "$opf" "missing EPUB 3 cover-image manifest item"
require_pattern '<spine toc="ncx">[[:space:]]*<itemref idref="cover_xhtml" />[[:space:]]*<itemref idref="ch001_xhtml" />[[:space:]]*<itemref idref="nav" linear="no" />' "$opf_flat" "illustrated cover and title page are not first in the reading spine"
require_pattern "<docTitle>[[:space:]]*<text>$visible_title_pattern</text>[[:space:]]*</docTitle>" "$toc_flat" "NCX title is not the visible title"
require_pattern "<title>$visible_title_pattern</title>" "$nav" "nav document title is not the visible title"
require_pattern "<h1[^>]*>$visible_title_pattern</h1>" "$nav" "nav table-of-contents heading is not the visible title"
require_pattern '<body id="cover" epub:type="cover">' "$image_cover" "illustrated cover XHTML is not marked as the cover"
require_pattern '<image[^>]+xlink:href="\.\./media/[^ "]+\.png"' "$image_cover" "illustrated cover XHTML does not reference the embedded cover image"
require_pattern '<body epub:type="frontmatter">' "$cover" "cover XHTML is not frontmatter"
require_pattern "<section id=\"$cover_id\" epub:type=\"titlepage\"" "$cover" "custom cover is not the first cover section"
require_pattern "<h1[^>]*text-align:[[:space:]]*center[^>]*>$visible_title_pattern</h1>" "$cover" "cover title is not explicitly centered"
require_pattern 'div\.sourceCode' "$stylesheet" "EPUB stylesheet is missing sourceCode wrapper rules"
require_pattern '^pre[[:space:]]*\{' "$stylesheet" "EPUB stylesheet is missing pre rules"
require_pattern 'line-height:[[:space:]]*1\.12' "$stylesheet" "EPUB stylesheet is missing compact code line-height"

reject_pattern 'UNTITLED|Unknown' "$opf" "fallback OPF metadata found"
reject_pattern 'UNTITLED|Unknown' "$toc" "fallback NCX metadata found"
reject_pattern 'UNTITLED|Unknown' "$nav" "fallback nav metadata found"
reject_pattern "<h1 class=\"unnumbered\">$visible_title_pattern</h1>" "$cover" "generated top-level cover heading found"
reject_pattern 'display:[[:space:]]*flex' "$cover" "cover uses flexbox, which is fragile on Kindle"

cover_href="$(perl -ne 'if (/<item(?=[^>]*properties="cover-image")(?=[^>]*href="([^"]+)")[^>]*>/) { print $1; exit }' "$opf")"
if [[ -z "$cover_href" ]]; then
  echo "EPUB metadata check failed: could not resolve embedded cover path" >&2
  exit 1
fi
unzip -p "$epub" "EPUB/$cover_href" > "$embedded_cover"
if [[ ! -f "$source_cover" ]] || ! cmp -s "$source_cover" "$embedded_cover"; then
  echo "EPUB metadata check failed: embedded cover differs from source cover" >&2
  exit 1
fi

if unzip -l "$epub" | awk '{print $4}' | grep -qx 'EPUB/text/title_page.xhtml'; then
  echo "EPUB metadata check failed: generated empty title_page.xhtml is present" >&2
  exit 1
fi

if [[ ! -f "$stable_epub" ]]; then
  echo "EPUB metadata check failed: stable title-stem EPUB is missing: $stable_epub" >&2
  exit 1
fi

if ! cmp -s "$epub_path" "$stable_epub"; then
  echo "EPUB metadata check failed: stable title-stem EPUB differs from canonical EPUB" >&2
  exit 1
fi

if [[ ! -f "$version_marker" ]]; then
  echo "EPUB metadata check failed: VERSION.md is missing" >&2
  exit 1
fi

stem_pattern="$(regex_escape "$expected_stem")"
require_pattern '^version_stamp: [0-9]+\.[0-9]+\.[0-9]+-[0-9a-z]+$' "$version_marker" "VERSION.md missing version stamp"
require_pattern '^source_commit: [0-9a-f]{8}$' "$version_marker" "VERSION.md missing source commit"
require_pattern '^built_at: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$version_marker" "VERSION.md missing UTC build timestamp"
require_pattern "^title_stem: ${stem_pattern}$" "$version_marker" "VERSION.md missing canonical title stem"
require_pattern "^kindle_name: $expected_title_pattern$" "$version_marker" "VERSION.md missing Kindle name"
require_pattern "^epub_file: $(regex_escape "$(basename "$stable_epub")")$" "$version_marker" "VERSION.md missing stable EPUB filename"
require_pattern "^pdf_file: ${stem_pattern}\.pdf$" "$version_marker" "VERSION.md missing stable PDF filename"
require_pattern "^epub_link: ${stem_pattern} \(.+\)\.epub$" "$version_marker" "VERSION.md missing versioned EPUB link"
require_pattern "^pdf_link: ${stem_pattern} \(.+\)\.pdf$" "$version_marker" "VERSION.md missing versioned PDF link"

epub_link="$(awk -F': ' '$1 == "epub_link" { print $2 }' "$version_marker")"
pdf_link="$(awk -F': ' '$1 == "pdf_link" { print $2 }' "$version_marker")"
[[ -L "$dist_dir/$epub_link" ]] || { echo "EPUB metadata check failed: missing symlink $epub_link" >&2; exit 1; }
[[ -L "$dist_dir/$pdf_link" ]] || { echo "EPUB metadata check failed: missing symlink $pdf_link" >&2; exit 1; }
[[ "$(readlink "$dist_dir/$epub_link")" == "$(basename "$stable_epub")" ]] || { echo "EPUB metadata check failed: EPUB link does not target stable EPUB" >&2; exit 1; }
[[ "$(readlink "$dist_dir/$pdf_link")" == "$expected_stem.pdf" ]] || { echo "EPUB metadata check failed: PDF link does not target stable PDF" >&2; exit 1; }

echo "EPUB metadata check passed: $epub"
