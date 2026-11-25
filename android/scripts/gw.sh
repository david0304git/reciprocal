#!/usr/bin/env bash
# Gradle wrapper pinned to a workspace-local GRADLE_USER_HOME.
#
# The sandbox only allows writes inside the session workspace, so the default ~/.gradle cannot be
# used from agent shells. This keeps caches in .gradle-home/ (git-ignored) and makes builds
# reproducible for every contributor shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GRADLE_USER_HOME="$ROOT/.gradle-home"
export ANDROID_USER_HOME="$ROOT/.gradle-home/android-user-home"
mkdir -p "$GRADLE_USER_HOME" "$ANDROID_USER_HOME"
exec "$ROOT/gradlew" "$@"
