#!/usr/bin/env bash
# Drive the app on a headless Android emulator: build, install, tap, screenshot.
#
# The Browser pane checks layout in a desktop engine. This checks it on the
# thing that actually ships: Android's WebView, at a real device density, with
# the system bars and the gesture inset in place. Clipping, touch targets and
# safe-area padding only tell the truth here.
#
#   bin/android-preview.sh boot        start the emulator (headless)
#   bin/android-preview.sh install     build the web bundle, sync, install
#   bin/android-preview.sh launch      start the app
#   bin/android-preview.sh shot NAME   save a screenshot
#   bin/android-preview.sh tap X Y     tap, in device pixels
#   bin/android-preview.sh text "..."  type into the focused field
#   bin/android-preview.sh log         recent app log lines
#   bin/android-preview.sh dark on|off switch the system theme
#   bin/android-preview.sh stop        shut the emulator down
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
ADB="$ANDROID_HOME/platform-tools/adb"
# Shared with the Overtime Calculator project. The two apps have different
# package ids so they coexist; override with AVD=... to use another device.
AVD="${AVD:-otc-test}"
PKG=com.john3004.calorietracker
OUT="${OUT:-$ROOT/.android-shots}"

case "${1:-}" in
  boot)
    if "$ADB" devices | grep -q emulator; then echo "already running"; exit 0; fi
    nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-window -no-audio \
      -no-boot-anim -gpu swiftshader_indirect -no-snapshot >/dev/null 2>&1 &
    echo "booting $AVD"
    "$ADB" wait-for-device
    until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
      perl -e 'select undef,undef,undef,2'
    done
    echo "ready"
    ;;
  install)
    (cd "$ROOT" && npm run build && npx cap sync android)
    (cd "$ROOT/android" && ./gradlew assembleRelease)
    "$ADB" install -r "$ROOT/android/app/build/outputs/apk/release/app-release.apk"
    ;;
  launch)  "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null; echo launched ;;
  restart) "$ADB" shell am force-stop "$PKG"; "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null; echo restarted ;;
  stopapp) "$ADB" shell am force-stop "$PKG"; echo stopped ;;
  shot)
    mkdir -p "$OUT"
    "$ADB" exec-out screencap -p > "$OUT/${2:-shot}.png"
    echo "$OUT/${2:-shot}.png"
    ;;
  tap)   "$ADB" shell input tap "$2" "$3" ;;
  swipe) "$ADB" shell input swipe "$2" "$3" "$4" "$5" "${6:-300}" ;;
  text)  "$ADB" shell input text "${2// /%s}" ;;
  key)   "$ADB" shell input keyevent "$2" ;;
  back)  "$ADB" shell input keyevent 4 ;;
  log)   "$ADB" logcat -d -t "${2:-80}" | grep -iE "capacitor|chromium|console|FATAL|AndroidRuntime" || true ;;
  size)  "$ADB" shell wm size; "$ADB" shell wm density ;;
  dark)  "$ADB" shell "cmd uimode night ${2:-yes}" ;;
  perm)  "$ADB" shell dumpsys package "$PKG" | sed -n '/requested permissions/,/install permissions/p' ;;
  rotate)
    "$ADB" shell settings put system accelerometer_rotation 0
    "$ADB" shell settings put system user_rotation "${2:-0}"   # 0 portrait, 1 landscape
    ;;
  # Evaluate JavaScript inside the running WebView and print the result.
  # Needs a debuggable WebView, so it works on the debug build only.
  stop)  "$ADB" emu kill 2>/dev/null || true; echo "emulator stopped" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
