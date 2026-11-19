#!/usr/bin/env bash
set -euo pipefail

test "$(uname -m)" = arm64
mkdir -p release-macos
case "${MACOS_TARGET:?}" in
  desktop)
    if ! brew list --versions mpv >/dev/null; then
      brew update
      if brew list --versions ca-certificates >/dev/null; then
        brew unlink ca-certificates
      fi
      HOMEBREW_NO_AUTO_UPDATE=1 brew install mpv
    fi
    export PLEXY_LIBMPV_SOURCE="$(brew --prefix mpv)/lib/libmpv.2.dylib"
    test -f "$PLEXY_LIBMPV_SOURCE"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    node scripts/install-ffmpeg.mjs
    bun run build:desktop
    app="dist/mac/mac-arm64/Plexy Beta.app"
    expected="$(node -p "require('./package.json').version")"
    test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = "$expected"
    test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")" = "$PLEXY_BUILD_NUMBER"
    codesign --verify --deep --strict --verbose=2 "$app"
    cp dist/mac/*.dmg dist/mac/*.zip release-macos/
    ;;
  backend)
    bash scripts/package-backend.sh macos-arm64 "${BACKEND_CONTENTS:-bundle}" release-macos
    ;;
  *) exit 1 ;;
esac
