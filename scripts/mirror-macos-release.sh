#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PLEXY_UPDATE_R2_BUCKET:-}" || -z "${PLEXY_UPDATE_ORIGIN:-}" || \
      -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${AWS_ACCESS_KEY_ID:-}" || \
      -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "::warning::Cloudflare R2 mirror is not configured. See the release mirror setup in README.md."
  exit 0
fi

[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[a-fA-F0-9]{32}$ ]]
origin="${PLEXY_UPDATE_ORIGIN%/}"
[[ "$origin" =~ ^https://[a-zA-Z0-9.-]+$ ]]
tag="v${PLEXY_RELEASE_VERSION:?}-build.${PLEXY_BUILD_NUMBER:?}"
[[ "$tag" =~ ^v[0-9A-Za-z.-]+$ ]]
endpoint="https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
prefix="macos/$tag"

shopt -s nullglob
installers=("$1"/*.dmg)
archives=("$1"/*.zip)
[[ ${#installers[@]} -eq 1 && ${#archives[@]} -eq 1 ]]

links=()
for artifact in "${installers[@]}" "${archives[@]}"; do
  test -s "$artifact"
  name="${artifact##*/}"
  [[ "$name" =~ ^[0-9a-zA-Z._-]+$ ]]
  case "$name" in
    *.dmg) type=application/x-apple-diskimage ;;
    *.zip) type=application/zip ;;
  esac
  aws --endpoint-url "$endpoint" s3 cp "$artifact" "s3://$PLEXY_UPDATE_R2_BUCKET/$prefix/$name" \
    --content-type "$type" --cache-control 'public, max-age=86400, immutable'
  url="$origin/$prefix/$name"
  curl --fail --silent --show-error --head --max-time 15 --retry 3 "$url" >/dev/null
  links+=("- [$name]($url)")
done

{
  echo 'links<<PLEXY_LINKS'
  printf '%s\n' "${links[@]}"
  echo 'PLEXY_LINKS'
} >> "${GITHUB_OUTPUT:?}"
