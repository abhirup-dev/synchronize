# Phase 1 — Toolchain & device bring-up

## Objective
A reproducible Android build/install environment on the Mac, with the phone authorized over ADB. No app code yet — this de-risks "can we build and install at all" before anything else.

## Depends on
Nothing. First phase.

## Current machine state (measured 2026-06-13)
- ✅ `adb` present (`/opt/homebrew/bin/adb`), `java 17` (LTS), `node v26`, `bun 1.3.10`.
- ✅ Tailscale installed (currently **stopped** — started in Phase 2).
- ❌ No Android SDK, no Android Studio.

## Steps
1. **Install the Android SDK command-line tools** (no full Android Studio needed for CLI builds):
   ```bash
   brew install --cask android-commandlinetools
   # or: download cmdline-tools, unzip to $HOME/Library/Android/sdk/cmdline-tools/latest
   ```
2. **Set environment** (persist in shell profile + a project `.env`/`.envrc`):
   ```bash
   export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"   # or ~/Library/Android/sdk
   export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
   export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
   ```
3. **Install SDK packages + accept licenses:**
   ```bash
   sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
   yes | sdkmanager --licenses
   ```
   (Gradle itself comes from the Capacitor project's Gradle wrapper in Phase 3 — only JDK + SDK are needed here.)
4. **Authorize the phone:** enable Developer Options (Settings → About → tap *Build number* ×7) and **USB debugging**; plug in via USB; approve the RSA fingerprint prompt on the phone.
5. **Verify & record the device:**
   ```bash
   adb devices -l                       # must show 'device', not 'unauthorized'
   adb shell getprop ro.product.model
   adb shell getprop ro.build.version.release   # Android version
   adb shell getprop ro.build.version.sdk       # API level
   adb shell getprop ro.product.cpu.abi         # arm64-v8a expected
   ```
6. **Add a doctor target** so future sessions can self-check:
   `make android-doctor` → checks `adb`, `sdkmanager`, `JAVA_HOME` (17), and an authorized device; prints the recorded device info.

## Files created/touched
- `mobile/README.md` (NEW) — env setup, SDK versions, device info, doctor usage.
- `Makefile` (touch) — `android-doctor` target.
- shell profile / `.envrc` — `ANDROID_HOME`, `JAVA_HOME`, `PATH`.

## Wiring
Nothing wired yet; this phase only produces a working toolchain that Phase 3's Gradle build consumes (`ANDROID_HOME`, build-tools, platform).

## Acceptance criteria
- [ ] `adb devices` lists the phone as `device` (authorized).
- [ ] `sdkmanager --list_installed` shows platform-tools, build-tools;35.0.0, platforms;android-35.
- [ ] `make android-doctor` passes and prints device model / Android / API / ABI.
- [ ] Device facts recorded in `mobile/README.md`.

## Risks & mitigations
- Phone stays `unauthorized` → re-plug, re-confirm the on-device prompt, `adb kill-server && adb start-server`.
- SDK path differs by install method → `android-doctor` resolves and prints the active `ANDROID_HOME`.

## Suggested `bd` units
- `Install + pin Android SDK toolchain; document in mobile/README` (task)
- `Add make android-doctor + record device facts` (task)
