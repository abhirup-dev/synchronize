# Phase 3 — Capacitor scaffold & first on-device install

## Objective
Stand up the `mobile/` Capacitor project, bundle the existing `web/dist`, and get the (current desktop) UI **running inside an installed APK** on the phone. Proves the build→sign→install→launch loop and surfaces any in-WebView CORS/mixed-content issues early.

## Depends on
Phase 1 (toolchain), Phase 2 (a reachable daemon endpoint + CORS).

## Steps
1. **Scaffold the Capacitor project** at `mobile/`:
   ```bash
   mkdir mobile && cd mobile
   bun init -y
   bun add @capacitor/core @capacitor/cli @capacitor/android @capacitor/app
   bunx cap init "Synchronize" "dev.synchronize.app" --web-dir ../web/dist
   ```
2. **Configure** `mobile/capacitor.config.ts`:
   ```ts
   import type { CapacitorConfig } from '@capacitor/cli';
   const config: CapacitorConfig = {
     appId: 'dev.synchronize.app',
     appName: 'Synchronize',
     webDir: '../web/dist',
     android: { allowMixedContent: false },
     server: { androidScheme: 'https' },   // app origin = https://localhost
   };
   export default config;
   ```
3. **Add the Android platform** and commit the generated project:
   ```bash
   bunx cap add android        # generates mobile/android (Gradle project) — commit it
   ```
4. **Network security config** (cleartext fallback only; HTTPS via Tailscale is primary):
   `mobile/android/app/src/main/res/xml/network_security_config.xml` allowing cleartext to the tailnet host only; reference it from `AndroidManifest.xml`. (Skip if using Tailscale Serve HTTPS exclusively.)
5. **Placeholder branding:** app icon + splash (real assets in Phase 10).
6. **Build → sync → install → launch:**
   ```bash
   (cd .. && bun run web/build.ts)          # produce web/dist
   bunx cap sync android                    # copy assets into the android project
   (cd android && ./gradlew assembleDebug)  # build debug APK
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   adb shell monkey -p dev.synchronize.app 1   # launch
   adb logcat | grep -i chromium            # watch WebView console for CORS/errors
   ```
7. **Temporary config** to reach the daemon this phase (before the native screen exists): inject `baseUrl`+token via a debug build constant or a one-off `localStorage` seed, just to confirm the UI talks to the daemon from inside the WebView. Replaced in Phase 4.
8. **Makefile targets:** `android-build`, `android-run` (web build → sync → install → launch), `android-logcat`.

## Files created/touched
- `mobile/` (NEW) — `package.json`, `capacitor.config.ts`, `android/` (committed).
- `mobile/android/app/src/main/res/xml/network_security_config.xml` (NEW, if cleartext fallback).
- `Makefile` (touch) — android targets.
- `.gitignore` (touch) — ignore `mobile/android/app/build`, keystores, `google-services.json` if secret.

## Wiring
`capacitor.config.ts` `webDir` points at `web/dist`, so `cap sync` packages the exact same SPA the daemon serves. The WebView loads it from `https://localhost`; data calls go cross-origin to the daemon (relying on Phase 2 CORS).

## Acceptance criteria
- [ ] `make android-run` builds, installs, and launches on the phone.
- [ ] The SPA renders inside the APK (desktop layout for now).
- [ ] With the temporary config, the app reaches the daemon: live data appears, no CORS errors in `logcat`.
- [ ] `mobile/android` committed and reproducible from a clean checkout.

## Risks & mitigations
- CORS errors that only appear inside the WebView (origin `https://localhost`) → ensure Phase 2 allow-list includes it.
- Mixed content (HTTPS app → HTTP daemon) → use Tailscale HTTPS (D5); keep `allowMixedContent:false`.
- Committing generated Gradle bloat → ignore `build/` outputs only, keep sources.

## Suggested `bd` units
- `Scaffold Capacitor mobile/ project + android platform` (feature)
- `capacitor.config + network security config + branding placeholders` (task)
- `Makefile android-build/run/logcat targets` (task)
- `First on-device install + WebView CORS smoke test` (task)
