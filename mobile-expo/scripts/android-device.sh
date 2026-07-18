#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-live}"
app_id="app.synchronize.mobile"
device_api_port="${SYNCHRONIZE_DEVICE_API_PORT:-58405}"
host_api_port="${SYNCHRONIZE_HOST_API_PORT:-$device_api_port}"
metro_port="${EXPO_METRO_PORT:-8081}"
apk="$project_dir/android/app/build/outputs/apk/release/app-release.apk"

usage() {
  printf '%s\n' \
    'Usage: android-device.sh live|apk|install-apk' \
    '' \
    '  live         Build/install a debug app and run Metro for Fast Refresh.' \
    '  apk          Build a self-contained release APK without installing it.' \
    '  install-apk  Build/install the release APK and connect its data API.' \
    '' \
    'Optional environment:' \
    '  ANDROID_SERIAL                 Physical device serial (auto-detected by default).' \
    '  SYNCHRONIZE_HOST_API_PORT      Host daemon port (default: 58405).' \
    '  SYNCHRONIZE_DEVICE_API_PORT    Port expected by the app (default: 58405).' \
    '  EXPO_METRO_PORT                Metro port (default: 8081).'
}

case "$mode" in
  live|apk|install-apk) ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_root" ]]; then
  for candidate in /opt/homebrew/share/android-commandlinetools "$HOME/Library/Android/sdk"; do
    if [[ -d "$candidate/platforms" ]]; then
      sdk_root="$candidate"
      break
    fi
  done
fi
if [[ -z "$sdk_root" || ! -d "$sdk_root/platforms" ]]; then
  echo 'Android SDK not found; set ANDROID_SDK_ROOT.' >&2
  exit 1
fi
export ANDROID_HOME="$sdk_root"
export ANDROID_SDK_ROOT="$sdk_root"
export PATH="$sdk_root/platform-tools:$PATH"
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.caching=true"

build_apk() {
  gradle_args=(assembleRelease --build-cache)
  if [[ -n "${1:-}" ]]; then
    gradle_args+=("-PreactNativeArchitectures=$1")
  fi
  NODE_ENV=production "$project_dir/android/gradlew" -p "$project_dir/android" "${gradle_args[@]}"
  [[ -f "$apk" ]] || { echo "APK was not produced at $apk" >&2; exit 1; }
  echo "APK: $apk"
}

if [[ "$mode" == apk ]]; then
  build_apk
  exit 0
fi

adb_bin="$(command -v adb)"
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  serial="$ANDROID_SERIAL"
  [[ "$("$adb_bin" -s "$serial" get-state 2>/dev/null)" == device ]] || {
    echo "ANDROID_SERIAL=$serial is not an authorized ADB device." >&2
    exit 1
  }
else
  serials=()
  while IFS= read -r value; do serials+=("$value"); done < <(
    "$adb_bin" devices | awk '$2 == "device" && $1 !~ /^emulator-/ { print $1 }'
  )
  if [[ ${#serials[@]} -ne 1 ]]; then
    echo "Expected one authorized physical device; found ${#serials[@]}. Set ANDROID_SERIAL." >&2
    "$adb_bin" devices -l >&2
    exit 1
  fi
  serial="${serials[0]}"
fi

"$adb_bin" -s "$serial" reverse "tcp:$device_api_port" "tcp:$host_api_port"

if [[ "$mode" == live ]]; then
  "$adb_bin" -s "$serial" reverse "tcp:$metro_port" "tcp:$metro_port"
  cd "$project_dir"
  exec ./node_modules/.bin/expo run:android --device "$serial" --port "$metro_port"
fi

build_apk arm64-v8a
"$adb_bin" -s "$serial" install -r "$apk"
"$adb_bin" -s "$serial" shell am force-stop "$app_id"
"$adb_bin" -s "$serial" shell am start -n "$app_id/.MainActivity"
echo "Installed on $serial; device port $device_api_port -> host port $host_api_port"
