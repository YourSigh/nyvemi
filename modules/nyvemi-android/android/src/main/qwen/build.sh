#!/usr/bin/env bash
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
work="$1"
ndk="$2"
cmake="$3"
abi="$4"
output="$5"

build() {
  local variant="$1" arch="$2" output_name="$3"
  local build_dir="$work/build-$abi-$variant"
  "$cmake/bin/cmake" -S "$src" -B "$build_dir" -G Ninja \
    -DCMAKE_MAKE_PROGRAM="$cmake/bin/ninja" \
    -DSPEECH_SOURCE="$work/speech" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="$ndk/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM=android-24 -DANDROID_STL=c++_static \
    -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_VULKAN=OFF -DGGML_CPU_KLEIDIAI=OFF \
    -DGGML_CPU_ARM_ARCH="$arch"
  "$cmake/bin/cmake" --build "$build_dir" --target nyvemi_qwen --parallel 4
  cp "$build_dir/libnyvemi_qwen.so" "$output/lib${output_name}.so"
}

mkdir -p "$output"
build baseline '' nyvemi_qwen
build dotprod 'armv8-a+dotprod+fp16' nyvemi_qwen_dotprod
