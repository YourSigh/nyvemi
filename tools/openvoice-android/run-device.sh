#!/bin/bash
# Use only after the phone QA owner grants an exclusive device window.
set -euo pipefail
WORK=${1:?isolated build directory required}
cd "$WORK"
shift
ADB=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
SERIAL=${1:?explicit ADB serial required}
MODELS=${2:?exported model directory required}
ROOT=/data/local/tmp/nyvemi-openvoice-port
"$ADB" -s "$SERIAL" shell mkdir -p "$ROOT/lib" "$ROOT/models"
"$ADB" -s "$SERIAL" push build/bench-dex.jar "$ROOT/bench-dex.jar"
"$ADB" -s "$SERIAL" push deps/jni/arm64-v8a/libonnxruntime.so deps/jni/arm64-v8a/libonnxruntime4j_jni.so "$ROOT/lib/"
"$ADB" -s "$SERIAL" push "$MODELS/." "$ROOT/models/"
shift 2
for manifest in "$@"; do
  "$ADB" -s "$SERIAL" shell "CLASSPATH=$ROOT/bench-dex.jar LD_LIBRARY_PATH=$ROOT/lib app_process64 -Djava.library.path=$ROOT/lib /system/bin OpenVoiceBench $ROOT/models/$manifest"
done
mkdir -p device-results
for manifest in "$@"; do
  case_dir=$(dirname "$manifest")
  mkdir -p "device-results/$case_dir"
  "$ADB" -s "$SERIAL" pull "$ROOT/models/$case_dir/android-output.f32" "device-results/$case_dir/"
  "$ADB" -s "$SERIAL" pull "$ROOT/models/$case_dir/android-output.f32.metrics.json" "device-results/$case_dir/"
done
