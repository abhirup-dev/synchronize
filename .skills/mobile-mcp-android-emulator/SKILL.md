---
name: mobile-mcp-android-emulator
description: Use when launching or operating the local Pixel Android emulator through ADB, Mobile MCP, Open Design, Claude Code, or Codex on this Mac.
user-invokable: true
argument-hint: "[launch|verify|mcp|recover] [app or prototype target]"
od:
  mode: prototype
  surface: web
  platform: mobile
  scenario: design
  category: android-runtime
  design_system:
    requires: false
  example_prompt: "Launch the Pixel Android emulator and verify an Open Design mobile prototype with Mobile MCP."
---

# Mobile MCP Android Emulator

## Local Runtime

- SDK root: `/opt/homebrew/share/android-commandlinetools`
- AVD: `Pixel_7_Pro_API_36`
- Device id after boot: `emulator-5554`
- Display: `1080x2340`, `420dpi`
- Snapshot: `opendesign-dev`
- GPU: `host`; expected renderer includes `Google (Apple)` and `Apple M1 Pro`
- Launcher: `/Users/abhirupdas/Documents/Codex/2026-07-03/so-right-now-we-have-claude/outputs/android/launch-pixel-7-pro.sh`
- Snapshot saver: `/Users/abhirupdas/Documents/Codex/2026-07-03/so-right-now-we-have-claude/outputs/android/save-pixel-7-pro-snapshot.sh`

## Launch

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/platform-tools:$PATH"

/Users/abhirupdas/Documents/Codex/2026-07-03/so-right-now-we-have-claude/outputs/android/launch-pixel-7-pro.sh
```

The launcher starts a visible emulator, restores `opendesign-dev`, and defaults to `-gpu host`. Do not use `-gpu auto` or software GL for normal work because auto can fall back to SwiftShader under memory pressure.

After installing or configuring an app:

```bash
/Users/abhirupdas/Documents/Codex/2026-07-03/so-right-now-we-have-claude/outputs/android/save-pixel-7-pro-snapshot.sh
```

## Verify

```bash
adb devices
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 shell wm size
adb -s emulator-5554 shell wm density
adb -s emulator-5554 shell dumpsys SurfaceFlinger | grep -iE 'GLES:|SwiftShader|Apple|ANGLE|Vulkan' | head -20
```

Expected:

- `sys.boot_completed` is `1`
- size is `1080x2340`
- density is `420`
- renderer is `Google (Apple)` / `Apple M1 Pro`, not `SwiftShader`

Network check:

```bash
adb -s emulator-5554 shell ping -c 1 -W 5 8.8.8.8
adb -s emulator-5554 shell dumpsys connectivity | grep -E 'VALIDATED|DnsAddresses|INTERNET' | head -40
```

## Mobile MCP

Use package `@mobilenext/mobile-mcp@0.0.61`:

```bash
npx -y @mobilenext/mobile-mcp@0.0.61
```

Use these env vars for Claude, Codex, Open Design, and direct MCP subprocesses:

```bash
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
MOBILEMCP_DISABLE_TELEMETRY=1
```

Open Design external MCP server config:

```json
{
  "id": "mobile-mcp",
  "label": "Mobile MCP",
  "transport": "stdio",
  "enabled": true,
  "command": "npx",
  "args": ["-y", "@mobilenext/mobile-mcp@0.0.61"],
  "env": {
    "ANDROID_HOME": "/opt/homebrew/share/android-commandlinetools",
    "ANDROID_SDK_ROOT": "/opt/homebrew/share/android-commandlinetools",
    "MOBILEMCP_DISABLE_TELEMETRY": "1"
  }
}
```

## Tool Behavior

Working on this AVD:

- device list, screen size, orientation get/set
- screenshots: inline and saved file
- accessibility element listing; can be slow on heavy web pages
- coordinate tap, double tap, long press, swipe
- HOME/BACK and other button presses
- text entry into focused fields
- open URL
- list apps
- terminate app

Known limitations in `@mobilenext/mobile-mcp@0.0.61` on this emulator:

- `mobile_launch_app` failed for Chrome and Settings even though the packages existed; use ADB or `mobile_open_url` when possible.
- screen recording start/stop was unreliable.
- crash listing failed through bundled `mobilecli` while ADB itself was healthy.
- install/uninstall were not destructive-tested.

## Recovery

Chrome ANR:

```bash
adb -s emulator-5554 shell am force-stop com.android.chrome
adb -s emulator-5554 shell input keyevent KEYCODE_HOME
```

Snapshot renderer mismatch or `UNSUPPORTED_VK_APP` on save:

```bash
adb -s emulator-5554 shell am force-stop com.android.chrome
adb -s emulator-5554 shell input keyevent KEYCODE_HOME
adb -s emulator-5554 emu avd snapshot save opendesign-dev
```

If snapshot restore reports a GLES renderer change, cold boot once with `-gpu host`, keep Chrome closed, then save `opendesign-dev` again.
