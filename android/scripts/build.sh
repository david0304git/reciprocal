#!/usr/bin/env bash
# Serializes Gradle invocations between parallel agent shells.
#
# Two Gradle builds writing `app/build/` at the same time corrupt each other, and the Kotlin
# compile is the expensive part, so every agent goes through this lock.
#
#   scripts/build.sh :app:compileDebugKotlin
#   scripts/build.sh :app:assembleDebug
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/.gradle-home/build.lock"
STALE_MINUTES=20

mkdir -p "$ROOT/.gradle-home"

acquired=0
for _ in $(seq 1 720); do
  if mkdir "$LOCK" 2>/dev/null; then
    acquired=1
    break
  fi
  # Recover from a lock left behind by a killed build.
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +$STALE_MINUTES 2>/dev/null)" ]; then
    echo "[build] removing stale lock (older than ${STALE_MINUTES}m)"
    rm -rf "$LOCK"
    continue
  fi
  sleep 3
done

if [ "$acquired" -ne 1 ]; then
  echo "[build] could not acquire build lock" >&2
  exit 1
fi

cleanup() { rm -rf "$LOCK"; }
trap cleanup EXIT INT TERM

echo "[build] lock acquired: $*"
GRADLE_USER_HOME="$ROOT/.gradle-home" ANDROID_USER_HOME="$ROOT/.gradle-home/android-user-home" \
  "$ROOT/gradlew" --project-dir "$ROOT" --console=plain "$@"
