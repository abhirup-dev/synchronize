# Synchronize — native Android app (Expo)

Native Android client for the Synchronize daemon, built with Expo (SDK 57, React Native,
expo-router). Flat Material 3 design per the shortlisted design decisions: open chat
stream + focused threads (D-001), Activity command center with room grouping (D-002/D-003),
plus Agents roster/profile, spawn composer, archive/resume, and Me/connection screens.

## Run against the local daemon (emulator)

The daemon runs on the Mac; the emulator reaches it through adb reverse. The daemon port
is dynamic per run — find it with `lsof -nP -iTCP -sTCP:LISTEN | grep bun` and probing
`/web/state`, then:

```bash
adb -s emulator-5554 reverse tcp:<port> tcp:<port>
```

The default base URL is `http://127.0.0.1:58405` and is editable at runtime on the
**Me** tab (e.g. set your Mac's LAN IP when running on a real phone on the same Wi-Fi).

## Development

```bash
bun install
./node_modules/.bin/expo run:android          # debug build + metro
```

## Release APK (self-contained, no metro)

```bash
cd android && ./gradlew :app:assembleRelease -x lint
adb install -r app/build/outputs/apk/release/app-release.apk
```

## Architecture

- `src/theme/` — flat M3 tokens (light + dark), identity color hash
- `src/lib/api.ts` — daemon REST client (contract: native-android-daemon-contract.md)
- `src/lib/store.tsx` — peer registration + 4s polling store with change-signature
  render skipping (SSE invalidation can be layered on later)
- `src/app/` — expo-router: (tabs)/(rooms|agents) stacks, activity, me, spawn modal

ponytail: daemon URL is in-memory only (set per launch on Me tab); persist via
expo-sqlite kv if it becomes annoying. Polling instead of SSE per the contract's
sanctioned fallback.
