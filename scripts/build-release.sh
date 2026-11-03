#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Gradle's incremental React asset directory can retain removed bundled images.
# A release must start with a clean app output, then inspect the shipped bytes.
export EXPO_NO_DOTENV=1
export NODE_ENV=production
./android/gradlew -p android :app:clean assembleRelease "$@"
node scripts/check-release.cjs android/app/build/outputs/apk/release/app-release.apk
