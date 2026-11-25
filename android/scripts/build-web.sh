#!/usr/bin/env bash
# Builds the React frontend and copies the bundle into the Android assets folder.
#
#   scripts/build-web.sh            # production bundle
#   scripts/build-web.sh --check    # type-check only
#
# The generated `app/src/main/assets/web/` directory is committed so that
# `./gradlew assembleDebug` (and Android Studio) work without Node installed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The Android UI fork lives next to the Gradle project so both apps build independently.
WEB="$ROOT/web"
ASSETS="$ROOT/app/src/main/assets/web"

cd "$WEB"

if [ ! -d node_modules ]; then
  npm ci --cache ./.npm-cache --no-audit --no-fund
fi

if [ "${1:-}" = "--check" ]; then
  npx tsc --noEmit
  exit 0
fi

npm run build

rm -rf "$ASSETS"
mkdir -p "$ASSETS"
cp -R dist/. "$ASSETS/"

echo "web bundle -> $ASSETS"
du -sh "$ASSETS"
