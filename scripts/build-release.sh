#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Gradle's incremental React asset directory can retain removed bundled images.
# A release must start with a clean app output, then inspect the shipped bytes.
export EXPO_NO_DOTENV=1
export NODE_ENV=production
for arg in "$@"; do
  case "$arg" in
    -PnyvemiQwenModel*|-PnyvemiOpenVoicePack*|-PreactNativeArchitectures*) echo 'Release model/ABI options are controlled by this script' >&2; exit 2 ;;
  esac
done
./android/gradlew -p android :app:clean assembleRelease "$@" -PreactNativeArchitectures=arm64-v8a
node scripts/check-release.cjs android/app/build/outputs/apk/release/app-release.apk

node scripts/check-openvoice-apk.cjs android/app/build/outputs/apk/release/app-release.apk
