#!/usr/bin/env bash
set -euo pipefail

platform="$1"
contents="$2"
output="$3"
mkdir -p "$output"
case "$contents" in
  binary)
    bun run --filter @plexy/server compile
    apps/server/dist/plexy-server --version
    tar -czf "$output/plexy-server-$platform-binary.tar.gz" -C apps/server/dist plexy-server
    ;;
  bundle)
    node scripts/install-ffmpeg.mjs
    if [ ! -f dist/web/index.html ]; then
      bun run build:web
    fi
    bun run turbo run assemble:server --filter=@plexy/server
    ./dist/server/ffmpeg -version
    ./dist/server/plexy-server --version
    tar -czf "$output/plexy-server-$platform.tar.gz" -C dist/server .
    ;;
  *) exit 1 ;;
esac
