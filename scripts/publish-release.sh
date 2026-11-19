#!/usr/bin/env bash
set -euo pipefail

notes_file="$1"
shift
if [ "$#" -eq 0 ]; then exit 0; fi
for asset in "$@"; do
  test -s "$asset"
done

version="${PLEXY_RELEASE_VERSION:?Missing release version}"
tag="v${version}-build.${PLEXY_BUILD_NUMBER:?Missing reserved Plexy build number}"
flags=()
if [[ "$version" == *-beta.* ]]; then
  title="Plexy Beta ${tag}"
  flags+=(--prerelease)
else
  title="Plexy ${tag}"
  flags+=(--latest)
fi

notes=(--notes "Build artifacts are published as each platform finishes.")
if [ -n "$notes_file" ]; then notes=(--notes-file "$notes_file"); fi

if ! gh release view "$tag" >/dev/null 2>&1; then
  if gh release create "$tag" "$@" --target "$GITHUB_SHA" \
    --title "$title" "${flags[@]}" "${notes[@]}"; then
    exit 0
  fi
  # Another platform may have created the release while this job was uploading.
  gh release view "$tag" >/dev/null
fi

gh release upload "$tag" "$@" --clobber
if [ -n "$notes_file" ] && [ "${PLEXY_KEEP_RELEASE_NOTES:-}" != true ]; then
  gh release edit "$tag" --draft=false --title "$title" "${notes[@]}"
fi
