#!/usr/bin/env bash
set -euo pipefail
assets="$1/openvoice"
pack="${2:-}"
mkdir -p "$assets"
if [[ -z "$pack" ]]; then
  rm -f "$assets/openvoice-v2-android-1.zip"
  exit 0
fi
printf '%s  %s\n' 9f6d7822c57371227e70803481c7c8cddcbbc5848f0d9e8234bbe941f3bb64e6 "$pack" | shasum -a 256 -c -
cp "$pack" "$assets/openvoice-v2-android-1.zip"
