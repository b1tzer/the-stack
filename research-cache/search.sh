#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'Usage: %s PATTERN [RESOURCE_ID]\n' "$0" >&2
  exit 2
fi

pattern=$1
resource_id=${2:-}
root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
search_dir="$root_dir/extracted"

if [[ ! -d "$search_dir" ]]; then
  printf 'Local cache is missing. Run %s/fetch.sh first.\n' "$root_dir" >&2
  exit 3
fi

if [[ -n "$resource_id" ]]; then
  search_dir="$search_dir/$resource_id"
  if [[ ! -d "$search_dir" ]]; then
    printf 'Resource is not downloaded: %s\n' "$resource_id" >&2
    exit 4
  fi
fi

rg \
  --ignore-case \
  --hidden \
  --glob '!.complete' \
  --glob '!*.class' \
  --glob '!*.jar' \
  --glob '!*.pdf' \
  --max-count 8 \
  -- "$pattern" "$search_dir"
