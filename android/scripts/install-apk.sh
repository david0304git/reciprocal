#!/usr/bin/env bash
# Builds the debug APK (web bundle included) and installs it on the attached device/emulator.
#
#   scripts/install-apk.sh              # build + install + launch
#   scripts/install-apk.sh --no-build   # install the existing APK only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"

if [ "${1:-}" != "--no-build" ]; then
  "$ROOT/scripts/build.sh" :app:assembleDebug
fi

if [ ! -f "$APK" ]; then
  echo "APK not found: $APK" >&2
  exit 1
fi

"$ADB" install -r "$APK"
"$ADB" shell am start -n com.lutszhong.reciprocal/.MainActivity
