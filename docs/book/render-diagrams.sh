#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

export PATH="$PWD/node_modules/.bin:$PATH"
export PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/data/data/com.termux/files/usr/bin/headless_shell}"

config="docs/book/puppeteer-config.json"
if [[ ! -f "$config" ]]; then
  echo "missing puppeteer config: $config" >&2
  exit 1
fi

local_mmdc_index="node_modules/@mermaid-js/mermaid-cli/src/index.js"
if [[ -f "$local_mmdc_index" ]]; then
  perl -0pi -e 's/page\.goto\(url\.pathToFileURL\(mermaidHTMLPath\)\.href\)/page.goto(url.pathToFileURL(mermaidHTMLPath).href, { timeout: 0 })/g' "$local_mmdc_index"
fi

for source in docs/book/diagrams/*.mmd; do
  [[ -f "$source" ]] || continue
  target="${source%.mmd}.png"
  # Skip diagrams whose PNG is already up to date, so the book builds on
  # machines without a headless browser when no diagram changed.
  if [[ -f "$target" && ! "$source" -nt "$target" ]]; then
    continue
  fi
  mmdc -i "$source" -o "$target" -b white -s 2 -p "$config"
done
