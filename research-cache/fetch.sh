#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
manifest="$root_dir/manifest.tsv"
download_dir="$root_dir/downloads"
extract_dir="$root_dir/extracted"

mkdir -p "$download_dir" "$extract_dir"

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

fetch_one() {
  local id=$1 kind=$2 filename=$3 expected_hash=$4 primary_url=$5 fallback_urls=$6
  local archive="$download_dir/$filename"
  local destination="$extract_dir/$id"
  local marker="$destination/.complete"
  local actual_hash
  local downloaded=false
  local url

  if [[ ! -f "$archive" ]]; then
    printf 'Downloading %s...\n' "$id"
    for url in "$primary_url" $fallback_urls; do
      printf 'Trying %s\n' "$url"
      if curl \
        --fail \
        --location \
        --retry 3 \
        --retry-delay 3 \
        --retry-all-errors \
        --connect-timeout 20 \
        --output "$archive.part" \
        "$url"; then
        mv "$archive.part" "$archive"
        downloaded=true
        break
      fi
      rm -f "$archive.part"
    done
    if [[ "$downloaded" != "true" ]]; then
      printf 'All download sources failed for %s\n' "$id" >&2
      return 1
    fi
  fi

  actual_hash=$(hash_file "$archive")
  if [[ "$expected_hash" != "-" && "$expected_hash" != "$actual_hash" ]]; then
    printf 'Checksum mismatch for %s: expected %s, got %s\n' "$id" "$expected_hash" "$actual_hash" >&2
    return 1
  fi

  if [[ -f "$marker" && "$(cat "$marker")" == "$actual_hash" ]]; then
    printf 'Ready %s\n' "$id"
    return 0
  fi

  printf 'Extracting %s...\n' "$id"
  rm -rf "$destination"
  mkdir -p "$destination"
  case "$kind" in
    zip|jar)
      unzip -q "$archive" -d "$destination"
      ;;
    tar.gz)
      tar -xzf "$archive" -C "$destination" --strip-components=1
      ;;
    *)
      printf 'Unsupported kind: %s\n' "$kind" >&2
      return 1
      ;;
  esac
  printf '%s\n' "$actual_hash" > "$marker"
  printf 'Ready %s\n' "$id"
}

requested_id=${1:-}
found=false
while IFS=$'\t' read -r id kind filename expected_hash primary_url fallback_urls; do
  [[ "$id" == "id" ]] && continue
  if [[ -n "$requested_id" && "$requested_id" != "$id" ]]; then
    continue
  fi
  found=true
  fetch_one "$id" "$kind" "$filename" "$expected_hash" "$primary_url" "$fallback_urls"
done < "$manifest"

if [[ "$found" != "true" ]]; then
  printf 'Unknown resource id: %s\n' "$requested_id" >&2
  exit 2
fi
