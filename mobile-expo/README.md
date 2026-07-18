# Synchronize Expo Android

This app has two local Android workflows. Run commands from `mobile-expo/` with
one authorized physical Android device connected over USB.

## Live development with Metro

```text
TypeScript / React edits
          |
          v
  Metro on Mac :8081 <==== ADB reverse over USB ==== Android debug app
                                                    (Fast Refresh)

Synchronize daemon on Mac :58405 <== ADB reverse == app API :58405
```

Metro turns the React Native JavaScript into a development bundle and serves it
from the Mac. The debug app downloads that bundle; Fast Refresh applies most UI
edits without rebuilding the APK.

```bash
bun run android:device
```

Keep that command running while developing. If the daemon uses another host
port, map it without changing app code:

```bash
SYNCHRONIZE_HOST_API_PORT=58745 bun run android:device
```

## Self-contained APK

```text
TypeScript / React source
          |
          v
 Gradle + Expo bundle
          |
          v
 app-release.apk  ---- ADB install ----> Android app (Metro not needed)
                                              |
                                              +---- ADB reverse ----> daemon on Mac
```

Build the APK only:

```bash
bun run android:apk
```

That artifact is universal across the Android CPU targets configured by the
project. The physical-device command below compiles only `arm64-v8a`, the Pixel
7 Pro's native architecture, which keeps its APK smaller without changing app
resources or runtime behaviour. Release mode uses Hermes and optimized native
code rather than Metro's debug runtime.

Build, install, launch, and connect it to the daemon:

```bash
bun run android:device:apk
```

The artifact is
`android/app/build/outputs/apk/release/app-release.apk`. ADB reverse rules last
only while the device remains connected and can disappear after a reboot; rerun
the device command to restore them.

The current `release` variant is suitable for internal USB installs but is
signed with the repository's debug key. Before distributing through Google Play,
add protected production signing credentials and produce an Android App Bundle
(`.aab`) in CI or EAS Build. Never commit a production keystore.

## Build caches and worktrees

Gradle dependencies and reusable task outputs are shared safely across
worktrees through `~/.gradle/caches`; native compilation also uses the machine's
shared `ccache`. Generated outputs under `android/app/build` and `.cxx` remain
worktree-local so one branch cannot supply stale output to another. Metro keeps
its transform cache in the macOS temporary directory. The tracked device script
enables Gradle's shared, content-addressed build cache for both workflows.
