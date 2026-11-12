#!/usr/bin/env bash
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
work="$1"
ndk="$2"
cmake="$3"
abi="$4"
lib="$5"

"$cmake/bin/cmake" -S "$src" -B "$work/build-$abi" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$cmake/bin/ninja" \
  -DSPEECH_SOURCE="$work/speech" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$ndk/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 -DANDROID_STL=c++_static \
  -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_VULKAN=OFF -DGGML_CPU_KLEIDIAI=OFF
"$cmake/bin/cmake" --build "$work/build-$abi" --target nyvemi_qwen --parallel 4
mkdir -p "$(dirname "$lib")"
cp "$work/build-$abi/libnyvemi_qwen.so" "$lib"
