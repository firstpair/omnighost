#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
vault_path="${OMNIGHOST_VAULT:-/Users/alexy/Documents/epaolo}"
plugin_dir="$vault_path/.obsidian/plugins/omnighost"

cd "$repo_root"

npm run build

mkdir -p "$plugin_dir"
cp main.js styles.css manifest.json "$plugin_dir"/

echo "Installed Omnighost into: $plugin_dir"
echo
echo "Checksums:"
for file in main.js styles.css manifest.json; do
	printf '%s\n' "-- $file"
	shasum -a 256 "$file" "$plugin_dir/$file"
done

echo
printf 'Installed manifest version: '
python3 - "$plugin_dir/manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["version"])
PY
