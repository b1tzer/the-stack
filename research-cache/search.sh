#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
manifest="$root_dir/manifest.tsv"
extract_dir="$root_dir/extracted"

usage() {
  cat >&2 <<'EOF'
Usage:
  search.sh --list
  search.sh PATTERN --resource RESOURCE_ID
  search.sh PATTERN --product PRODUCT [--version VERSION] [--kind source|docs|spec]
EOF
}

lower() {
  printf '%s\n' "$1" | tr '[:upper:]' '[:lower:]'
}

pattern=""
resource_id=""
product=""
version=""
resource_kind=""
list_only=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)
      list_only=true
      shift
      ;;
    --resource)
      [[ $# -ge 2 ]] || { printf -- '--resource requires a value\n' >&2; usage; exit 2; }
      resource_id=$2
      shift 2
      ;;
    --product)
      [[ $# -ge 2 ]] || { printf -- '--product requires a value\n' >&2; usage; exit 2; }
      product=$2
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || { printf -- '--version requires a value\n' >&2; usage; exit 2; }
      version=$2
      shift 2
      ;;
    --kind)
      [[ $# -ge 2 ]] || { printf -- '--kind requires a value\n' >&2; usage; exit 2; }
      resource_kind=$2
      shift 2
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      exit 2
      ;;
    *)
      if [[ -n "$pattern" ]]; then
        printf 'Only one search pattern is allowed; pass a resource ID with --resource\n' >&2
        usage
        exit 2
      fi
      pattern=$1
      shift
      ;;
  esac
done

[[ -f "$manifest" ]] || {
  printf 'Manifest is missing: %s\n' "$manifest" >&2
  exit 3
}

if [[ "$list_only" == true ]]; then
  if [[ -n "$pattern" || -n "$resource_id" || -n "$product" || -n "$version" || -n "$resource_kind" ]]; then
    printf -- '--list cannot be combined with search filters\n' >&2
    usage
    exit 2
  fi
  printf 'id\tproduct\tversion\tref\tcommit\tkind\tpath\tstatus\tprimary_url\n'
  while IFS=$'\t' read -r id archive_kind type product_name version_name ref commit filename expected_hash primary_url fallback_urls; do
    [[ "$id" == "id" ]] && continue
    marker="$extract_dir/$id/.complete"
    if [[ -f "$marker" ]]; then
      if [[ "$(cat "$marker")" == "$expected_hash" ]]; then
        state=verified
      else
        state=stale
      fi
    elif [[ -d "$extract_dir/$id" ]]; then
      state=incomplete
    else
      state=missing
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\textracted/%s\t%s\t%s\n' \
      "$id" "$product_name" "$version_name" "$ref" "$commit" "$type" "$id" "$state" "$primary_url"
  done < "$manifest"
  exit 0
fi

if [[ -z "$pattern" ]]; then
  printf 'A search pattern is required\n' >&2
  usage
  exit 2
fi
if [[ -z "$resource_id" && -z "$product" ]]; then
  printf 'Select resources with --resource or --product; unscoped cache scans are disabled\n' >&2
  usage
  exit 2
fi
if [[ -z "$product" && ( -n "$version" || -n "$resource_kind" ) ]]; then
  printf -- '--version and --kind require --product\n' >&2
  usage
  exit 2
fi
if [[ -n "$resource_kind" && "$resource_kind" != "source" && "$resource_kind" != "docs" && "$resource_kind" != "spec" ]]; then
  printf 'Unsupported kind: %s (expected source, docs, or spec)\n' "$resource_kind" >&2
  exit 2
fi

selected_ids=()
while IFS=$'\t' read -r id archive_kind type product_name version_name ref commit filename expected_hash primary_url fallback_urls; do
  [[ "$id" == "id" ]] && continue
  if [[ -n "$resource_id" && "$id" != "$resource_id" ]]; then
    continue
  fi
  if [[ -n "$product" && "$(lower "$product_name")" != "$(lower "$product")" ]]; then
    continue
  fi
  if [[ -n "$version" && "$version_name" != "$version" ]]; then
    continue
  fi
  if [[ -n "$resource_kind" && "$type" != "$resource_kind" ]]; then
    continue
  fi
  selected_ids+=("$id")
done < "$manifest"

if [[ ${#selected_ids[@]} -eq 0 ]]; then
  if [[ -n "$resource_id" ]]; then
    printf 'Unknown resource id: %s\n' "$resource_id" >&2
  else
    printf 'No manifest resource matches product=%s version=%s kind=%s\n' \
      "$product" "$version" "$resource_kind" >&2
  fi
  exit 2
fi

if [[ ! -d "$extract_dir" ]]; then
  printf 'Local cache is missing. Run %s/fetch.sh first.\n' "$root_dir" >&2
  exit 3
fi

found=false
for id in "${selected_ids[@]}"; do
  resource_path="$extract_dir/$id"
  marker="$resource_path/.complete"
  if [[ ! -d "$resource_path" ]]; then
    printf 'Resource is not downloaded: %s\n' "$id" >&2
    exit 4
  fi
  if [[ ! -f "$marker" ]]; then
    printf 'Resource completion marker is missing: %s\n' "$id" >&2
    exit 5
  fi

  while IFS=$'\t' read -r row_id archive_kind type product_name version_name ref commit filename expected_hash primary_url fallback_urls; do
    [[ "$row_id" == "$id" ]] || continue
    actual_hash=$(cat "$marker")
    if [[ "$actual_hash" != "$expected_hash" ]]; then
      printf 'Checksum mismatch for %s: expected %s, got %s; run fetch.sh %s\n' \
        "$id" "$expected_hash" "$actual_hash" "$id" >&2
      exit 5
    fi
    printf '# resource=%s | product=%s | version=%s | ref=%s | commit=%s | kind=%s | source=%s | path=extracted/%s\n' \
      "$id" "$product_name" "$version_name" "$ref" "$commit" "$type" "$primary_url" "$id"
    break
  done < "$manifest"

  if (
    cd "$root_dir"
    rg \
      --ignore-case \
      --hidden \
      --glob '!.complete' \
      --glob '!*.class' \
      --glob '!*.jar' \
      --glob '!*.pdf' \
      --max-count 8 \
      -- "$pattern" "extracted/$id"
  ); then
    found=true
  fi
done

if [[ "$found" != true ]]; then
  exit 1
fi
