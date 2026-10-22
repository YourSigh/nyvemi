#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git status --short
npm run lint
npm run typecheck
npm test
git diff --check
if [[ -f android/gradlew ]]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  (cd android && NODE_ENV=development ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain)
else
  echo 'Android native project not generated yet; run npx expo prebuild --platform android.'
fi
