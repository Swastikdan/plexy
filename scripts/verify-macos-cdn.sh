#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PLEXY_DESKTOP_CDN:-}" ]]; then
  echo "::notice::Gcore CDN is not configured. See the macOS download CDN setup in README.md."
  exit 0
fi

origin="${PLEXY_DESKTOP_CDN%/}"
[[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]]
repository="${GITHUB_REPOSITORY:?}"
[[ "$repository" =~ ^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$ ]]
tag="v${PLEXY_RELEASE_VERSION:?}-build.${PLEXY_BUILD_NUMBER:?}"
[[ "$tag" =~ ^v[0-9A-Za-z.-]+$ ]]

shopt -s nullglob
installers=("$1"/*.dmg)
archives=("$1"/*.zip)
[[ ${#installers[@]} -eq 1 && ${#archives[@]} -eq 1 ]]

sample="$(mktemp)"
trap 'rm -f "$sample"' EXIT
links=()
for artifact in "${installers[@]}" "${archives[@]}"; do
  test -s "$artifact"
  name="${artifact##*/}"
  [[ "$name" =~ ^[0-9a-zA-Z._-]+$ ]]
  url="$origin/$repository/releases/download/$tag/$name"
  # A browser redirect would bypass the CDN. Check the bytes without following it.
  if ! status="$(curl --fail --silent --show-error --max-time 25 --retry 2 \
      --range 0-63 --max-filesize 64 --output "$sample" --write-out '%{http_code}' "$url")" ||
      [[ "$status" != 206 || "$(wc -c < "$sample")" -ne 64 ]] ||
      ! head -c 64 "$artifact" | cmp -s - "$sample"; then
    echo "::warning::Gcore did not serve the expected bytes for $name. The GitHub release assets are available."
    exit 0
  fi
  links+=("- [$name]($url)")
done

{
  echo 'links<<PLEXY_LINKS'
  printf '%s\n' "${links[@]}"
  echo 'PLEXY_LINKS'
} >> "${GITHUB_OUTPUT:?}"
