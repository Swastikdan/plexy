#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PLEXY_ITCH_PROJECT:-}" || -z "${BUTLER_API_KEY:-}" ]]; then
  echo "::notice::The itch.io download mirror is not configured. See README.md."
  exit 0
fi

target="$PLEXY_ITCH_PROJECT"
[[ "$target" =~ ^[a-z0-9-]+/[a-z0-9-]+$ ]]
version="${PLEXY_RELEASE_VERSION:?}"
tag="v$version-build.${PLEXY_BUILD_NUMBER:?}"
channel=mac-arm64
if [[ "$version" == *-beta.* ]]; then channel=mac-arm64-beta; fi

shopt -s nullglob
installers=("$1"/*.dmg)
[[ ${#installers[@]} -eq 1 ]]
test -s "${installers[0]}"

work="$(mktemp -d)"
trap 'rm -r -- "$work"' EXIT
mkdir "$work/installer"
cp "${installers[0]}" "$work/installer/"
curl --fail --silent --show-error --location --retry 2 --max-time 60 \
  'https://broth.itch.zone/butler/linux-amd64/15.24.0/archive/default' --output "$work/butler.zip"
unzip -q "$work/butler.zip" -d "$work"
chmod +x "$work/butler"
"$work/butler" push "$work/installer" "$target:$channel" --userversion "$tag"

page="https://${target%%/*}.itch.io/${target#*/}"
if curl --fail --silent --show-error --location --retry 2 --max-time 20 --output /dev/null "$page"; then
  {
    echo 'links<<PLEXY_LINKS'
    printf '%s\n' "- [Latest macOS installers on itch.io]($page)"
    echo 'PLEXY_LINKS'
  } >> "${GITHUB_OUTPUT:?}"
else
  echo "::warning::The installer was uploaded, but the itch.io page is not publicly reachable."
fi
