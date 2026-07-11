#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
build_dir="$repo_root/docs/book/build/firstpair"
version="$(node -p "require('$repo_root/package.json').version")"
mkdir -p "$build_dir"

awk '
  $0 == "```{=ms}" { in_block = 1; next }
  in_block && /^```$/ { exit }
  in_block { print }
' "$repo_root/docs/book/cover.md" \
  | sed "s/{{KINDLE_NAME}}/omnighost-troff ($version)/g" \
  > "$build_dir/cover.ms"

pandoc "$repo_root/docs/book/omnighost.md" \
  --from markdown+smart \
  --to ms \
  --standalone \
  --toc \
  --number-sections \
  > "$build_dir/body.raw.ms"

# Pandoc emits GNU ms headings and unwrapped literal blocks. utmac uses its
# own heading macros, while Neatroff correctly honors no-fill lines literally.
awk '
  function wrap(line, width, cut, i) {
    width = 68
    while (length(line) > width) {
      cut = width
      for (i = width; i > 1; i -= 1) {
        if (substr(line, i, 1) == " ") {
          cut = i
          break
        }
      }
      print substr(line, 1, cut - 1)
      line = substr(line, cut + 1)
    }
    print line
  }
  /^\.NH [1-3]$/ {
    level = $2 + 1
    getline title
    print ".H" level " " title
    next
  }
  /^\.pdfsync$/ { next }
  /^\.nf$/ { literal = 1; print; next }
  /^\.fi$/ { literal = 0; print; next }
  { if (literal && length($0) > 68) wrap($0); else print }
' "$build_dir/body.raw.ms" > "$build_dir/body.ms"

cat "$build_dir/cover.ms" "$build_dir/body.ms" > "$build_dir/omnighost.tr"
