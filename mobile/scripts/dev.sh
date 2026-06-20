#!/usr/bin/env bash
# Build the synchronize Android app and, if an authorized device is attached,
# install + launch it. One pipeline, no duplicated web sources: the web UI is
# rebuilt with a root asset base (WEB_ASSET_BASE=/) into web/dist-mobile, which
# Capacitor bundles into the APK.
#
# Prerequisites (see mobile/README.md):
#   - Homebrew: `openjdk@21` (Capacitor 8 requires JDK 21) + `android-commandlinetools`
#   - bun, and an authorized adb device (USB debugging)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # mobile/
ROOT="$(cd "$HERE/.." && pwd)"                            # repo root

export ANDROID_HOME="${ANDROID_HOME:-$(brew --prefix)/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

JDK21="$(brew --prefix openjdk@21 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
[ -x "$JDK21/bin/java" ] || JDK21="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
[ -x "$JDK21/bin/java" ] || { echo "✖ JDK 21 not found — run: brew install openjdk@21"; exit 1; }
export JAVA_HOME="$JDK21"

echo "▸ building web mobile bundle (/ base → web/dist-mobile)"
( cd "$ROOT/web" && WEB_ASSET_BASE=/ WEB_DIST_DIR=dist-mobile bun run build )

echo "▸ cap sync android"
( cd "$HERE" && bunx cap sync android )

echo "▸ assembleDebug ($("$JAVA_HOME/bin/java" -version 2>&1 | head -1))"
echo "sdk.dir=$ANDROID_HOME" > "$HERE/android/local.properties"
( cd "$HERE/android" && ./gradlew assembleDebug --no-daemon --console=plain )

APK="$HERE/android/app/build/outputs/apk/debug/app-debug.apk"
if adb get-state >/dev/null 2>&1; then
  echo "▸ installing on $(adb shell getprop ro.product.model | tr -d '\r')"
  adb install -r "$APK"
  adb shell monkey -p dev.synchronize.app -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  echo "▸ launched ✓"
else
  echo "▸ no authorized device; APK built at: $APK"
fi
