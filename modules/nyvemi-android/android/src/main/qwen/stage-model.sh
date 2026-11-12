#!/usr/bin/env bash
set -euo pipefail
target="$1/qwen"
mkdir -p "$target"
cp "$(dirname "$0")/model-license.txt" "$target/LICENSE.txt"
if [ -z "$2" ]; then
  rm -f "$target/customvoice.gguf"
  exit 0
fi
printf '%s  %s\n' 67cbe04239d079d3e3649a054258b8cf1553a99a03cc5b38d57350c6905e4cbd "$2" | shasum -a 256 -c -
cp "$2" "$target/customvoice.gguf"
