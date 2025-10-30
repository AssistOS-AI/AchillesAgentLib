#!/bin/bash
# Scan JavaScript sources while ignoring most node_modules entries.
# Adjust INCLUDED_NODE_MODULES to keep specific dependencies in the report.

set -euo pipefail

# Add module folder names (relative to node_modules) to include in the count.
# Example: INCLUDED_NODE_MODULES=(my-shared-lib another-lib)
INCLUDED_NODE_MODULES=()

files=()

# Collect all JS/MJS files, pruning node_modules entirely for speed.
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(find . -path "*/node_modules" -prune -o -type f \( -name "*.js" -o -name "*.mjs" \) -print0)

# Collect explicitly included node_modules (if any).
if [[ ${#INCLUDED_NODE_MODULES[@]} -gt 0 ]]; then
  for module in "${INCLUDED_NODE_MODULES[@]}"; do
    while IFS= read -r -d '' module_path; do
      while IFS= read -r -d '' file; do
        files+=("$file")
      done < <(find "$module_path" -type f -name "*.*js" -print0)
    done < <(find . -type d -path "*/node_modules/${module}" -print0)
  done
fi

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No JavaScript files found."
  exit 0
fi

printf '%s\0' "${files[@]}" | xargs -0 wc -l | sort -n
