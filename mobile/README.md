# synchronize — Android app (Capacitor)

UI-only Android client for the synchronize daemon. A thin [Capacitor](https://capacitorjs.com)
shell wraps the **existing** React web UI (`../web`) — there is no second copy of the
UI and no forked build. See the full plan in [`../docs/plans/android-app/`](../docs/plans/android-app/).

## How it reuses the web UI (no duplication)

The same `web/build.ts` pipeline emits two bundles via env vars:

| Consumer | Command | Asset base | Output |
|---|---|---|---|
| Daemon (browser) | `bun run build` | `/web/` | `web/dist` |
| Android app | `WEB_ASSET_BASE=/ WEB_DIST_DIR=dist-mobile bun run build` | `/` | `web/dist-mobile` |

The app needs root-relative asset paths because the WebView serves the bundle at
`https://localhost/`, not under `/web/`. Capacitor's `webDir` points at `../web/dist-mobile`.

## Prerequisites (macOS)

```bash
brew install --cask android-commandlinetools     # Android SDK (sdkmanager)
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
yes | sdkmanager --licenses
brew install openjdk@21                           # Capacitor 8 REQUIRES JDK 21 (not 17)
bun install                                       # in mobile/ and ../web
```

- Authorize the device: enable **Developer options → USB debugging**, plug in, tap **Allow**.
  Verify with `adb devices` (must show `device`, not `unauthorized`).
- `dev.sh` auto-resolves `ANDROID_HOME` and JDK 21 from Homebrew.

## Build, install & run

```bash
bun run dev          # build web (mobile base) → cap sync → assembleDebug → install + launch
# or piecemeal:
bun run build:web    # rebuild ../web → web/dist-mobile
bun run sync         # cap sync android
```

## Live mirror / screenshots

```bash
scrcpy --stay-awake --max-size 1080      # mirror the phone on the Mac
adb exec-out screencap -p > shot.png     # one-off screenshot
```

## Status

- ✅ Scaffold builds and installs; the full web UI renders on-device.
- ⏭ Not yet wired to a real daemon — the app currently shows mock data. Pointing it
  at a remote daemon (Tailscale + token, native connection screen) is Phase 2 + Phase 4.

## Layout

```
mobile/
├─ capacitor.config.ts   appId dev.synchronize.app · webDir ../web/dist-mobile · androidScheme https
├─ scripts/dev.sh        build + install helper (env-resolving)
├─ android/              generated Gradle project (committed; build/ + assets/ gitignored)
└─ package.json          @capacitor/* core + plugins (preferences, keyboard, status-bar, haptics, app)
```
