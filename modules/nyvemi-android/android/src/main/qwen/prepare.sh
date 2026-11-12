#!/usr/bin/env bash
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
work="$1"
speech_revision=03555100287c118b41d1b475044e5ab1e07baa8c
ggml_revision=e1a9ac12edbb57402618fd6936598603f5ee6266

mkdir -p "$work"
fetch() {
  local repo="$1" revision="$2" name="$3" hash="$4"
  if [ ! -f "$work/$name.tgz" ]; then
    curl --fail --silent --show-error --location --retry 3 --max-time 180 \
      "https://codeload.github.com/nyosegawa/$repo/tar.gz/$revision" -o "$work/$name.tgz.part"
    mv "$work/$name.tgz.part" "$work/$name.tgz"
  fi
  if ! printf '%s  %s\n' "$hash" "$work/$name.tgz" | shasum -a 256 -c -; then
    rm -f "$work/$name.tgz"
    return 1
  fi
}
fetch speech.cpp "$speech_revision" speech 853b52b4e6fb936704204daa04a34c2fd58ec9269f001cc366ac364882c1e5f7
fetch ggml "$ggml_revision" ggml 9a1e31aa7414969117b3aae8f4edd709fd8c8551ba51eeb1652b7666d2f3f3dd

rm -rf "$work/speech"
mkdir -p "$work/speech/ggml" "$work/assets/licenses"
tar xf "$work/speech.tgz" --strip-components=1 -C "$work/speech"
tar xf "$work/ggml.tgz" --strip-components=1 -C "$work/speech/ggml"
patch --batch -d "$work/speech" -p1 < "$src/apk-model-region.patch"
cp "$work/speech/LICENSE" "$work/assets/licenses/speech.cpp.txt"
cp "$work/speech/ggml/LICENSE" "$work/assets/licenses/ggml.txt"
