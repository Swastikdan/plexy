#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PLEXY_ITCH_PROJECT:-}" || -z "${BUTLER_API_KEY:-}" ]]; then
  echo "::notice::The itch.io download mirror is not configured. See README.md."
  exit 0
fi

target="$PLEXY_ITCH_PROJECT"
[[ "$target" =~ ^[a-z0-9-]+/[a-z0-9-]+$ ]]
version="${PLEXY_RELEASE_VERSION:?}"
release_tag="v$version-build.${PLEXY_BUILD_NUMBER:?}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

curl --fail --silent --show-error --location --retry 2 --max-time 60 \
  'https://broth.itch.zone/butler/linux-amd64/15.24.0/archive/default' --output "$work/butler.zip"
unzip -q "$work/butler.zip" -d "$work"
chmod +x "$work/butler"

publish() {
  local file="$1" channel="$2" tag="$3"
  test -s "$file" || return 1
  # Passing a ZIP directly makes Butler unpack it. Stage every artifact as
  # a single file so itch.io can serve the exact bytes published on GitHub.
  mkdir "$work/$channel" || return 1
  ln -- "$file" "$work/$channel/" 2>/dev/null || cp -- "$file" "$work/$channel/" || return 1
  "$work/butler" push "$work/$channel" "$target:$channel" --userversion "$tag" || return 1
  if [[ -n "${PLEXY_ITCH_DOWNLOAD_ORIGIN:-}" ]]; then
    local origin="${PLEXY_ITCH_DOWNLOAD_ORIGIN%/}"
    [[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]] || return 1
    printf '{"url":"%s"}\n' "$origin/$channel/$tag" > "$work/itch-$channel.json" || return 1
    gh release upload "$tag" "$work/itch-$channel.json" --clobber || return 1
    if [[ "$tag" != "$release_tag" ]]; then
      gh release upload "$release_tag" "$work/itch-$channel.json" --clobber || return 1
    fi
  fi
}

shopt -s nullglob
failed=0
for file in "$1"/*; do
  tag="$release_tag"
  suffix=""
  [[ "$version" != *-beta.* ]] || suffix="-beta"
  case "${file##*/}" in
    *.dmg) channel="mac-arm64$suffix" ;;
    *.zip) channel="mac-arm64-zip$suffix" ;;
    plexy-server-*.tar.gz)
      channel="${file##*/}"
      channel="${channel%.tar.gz}$suffix"
      ;;
    Plexy-mobile-v*-Android.apk)
      # mobile-release only enables this mirror for the current startup policy.
      [[ "${MIRROR_ANDROID:-}" == true ]] || continue
      tag="${file##*/Plexy-mobile-}"
      tag="mobile-${tag%-Android.apk}"
      channel=android-arm64
      ;;
    *) continue ;;
  esac
  if ! publish "$file" "$channel" "$tag"; then
    echo "::warning::Could not mirror ${file##*/} to itch.io."
    failed=1
  fi
done
exit "$failed"
