#!/usr/bin/env bash
set -euo pipefail

policy="$1"
apk="$(jq -er .apkName "$policy")"
[[ "$apk" =~ ^Plexy-mobile-v[0-9]+\.[0-9]+\.[0-9]+-Android\.apk$ ]]
artifact="$(dirname "$policy")/$apk"
test -s "$artifact"
[[ "$(sha256sum "$artifact" | cut -d ' ' -f1)" == "$(jq -er .sha256 "$policy")" ]]
[[ "${CLOUDFLARE_ACCOUNT_ID:?}" =~ ^[a-fA-F0-9]{32}$ ]]
endpoint="https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
bucket="s3://${PLEXY_UPDATE_R2_BUCKET:?}/android"
aws --endpoint-url "$endpoint" s3 cp "$artifact" "$bucket/$apk" \
  --content-type application/vnd.android.package-archive --cache-control 'public, max-age=86400, immutable'
aws --endpoint-url "$endpoint" s3 cp "$policy" "$bucket/mobile-update.json" \
  --content-type application/json --cache-control 'public, max-age=60, must-revalidate'
aws --endpoint-url "$endpoint" s3 rm "$bucket/" --recursive \
  --exclude '*' --include 'Plexy-mobile-v*-Android.apk' --exclude "$apk"
