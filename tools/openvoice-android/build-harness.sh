#!/bin/bash
set -euo pipefail
SOURCE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:?isolated build directory required}
SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
mkdir -p "$WORK/deps" "$WORK/build/classes" "$WORK/build/dex"
cd "$WORK"
if [ ! -f deps/ort.aar ]; then
  curl -fL --connect-timeout 15 --max-time 180 https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.23.2/onnxruntime-android-1.23.2.aar -o deps/ort.aar
fi
printf '%s\n' '82048d1f462218adae4ba76477089ab0ba76093d84f733540066db1a8ba6b827  deps/ort.aar' | shasum -a 256 -c -
(cd deps && unzip -o ort.aar classes.jar 'jni/arm64-v8a/*')
javac --release 11 -cp "deps/classes.jar:$SDK/platforms/android-36/android.jar" -d build/classes "$SOURCE"/*.java
jar cf build/bench.jar -C build/classes .
"$SDK/build-tools/36.0.0/d8" --release --min-api 30 --lib "$SDK/platforms/android-36/android.jar" --output build/dex build/bench.jar deps/classes.jar
(cd build/dex && zip -q ../bench-dex.jar classes*.dex)
