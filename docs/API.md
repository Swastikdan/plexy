# Plexy server API

The HTTP API is implemented by `apps/server` and its shared request/response
types live in `packages/api-client`. API paths are rooted at `/api`. All API
requests except server status and the authentication endpoints require a paired
device credential.

## Pairing a device

1. On the server machine, create a pairing code in Plexy's device settings.
2. Send `POST /api/auth/pair` with JSON `{ "code": "123456", "name": "Phone" }`.
3. Store the returned `token` in the platform's protected credential store. The
   response also includes the paired `device` and stable `serverId`.
4. Send `Authorization: Bearer <token>` on API, artwork, subtitle, and stream
   requests. Do not place credentials in a URL, logs, analytics, or crash
   reports. Tokens can be revoked from the server's device settings.

`GET /api/server/status` is the unauthenticated discovery probe. It returns the
server version, stable opaque `serverId`, and setup state. Authenticated status
also includes runtime and administrator details. A client should remember the
server ID after pairing and warn if a saved address later identifies a
different server.

## Playback endpoints

- `GET /api/play/:fileId` returns the playback path, metadata, resume position,
  subtitle tracks, and playback URLs.
- `GET /api/stream/:fileId` serves direct media and supports HTTP byte ranges
  for seeking.
- `GET /api/download/:fileId` serves an existing source version as an
  attachment and supports `HEAD`/byte ranges so a native app can resume a local
  download. `GET /api/download/:fileId?maxHeight=720` transcodes and streams a
  generated quality cap to the client; optional `audio=<index>` selects the
  audio track in generated output. Generated downloads are streamed live and
  cannot resume after a connection interruption. Supported caps are 360, 480,
  720, 1080, 1440, and 2160.
- `GET /api/stream/:fileId/remux` and `/transcode` provide live conversion
  fallbacks. Live conversions are limited to two at a time; excess requests
  receive `503` and `Retry-After`.
- The transcode URL accepts optional `maxHeight` values `360`, `480`, `720`,
  `1080`, `1440`, or `2160`. It scales the live output down when the source is
  taller and selects a lower target bitrate. Omitting it preserves the current
  server-selected output. This is a manual quality cap for fallback streams;
  prepared HLS exposes its own variant qualities, while direct play uses the
  source file's quality.
- `GET /api/stream/:fileId/hls/:asset` serves prepared HLS playlists and
  segments.
- `GET /api/subtitles/:fileId` lists subtitle tracks;
  `GET /api/subtitles/:fileId/:track` serves WebVTT.
- `POST /api/progress` stores playback progress.

Native clients should attach Bearer auth to each media request and use a
playback stack that can authenticate HLS playlist and segment requests. A
browser `<video>` element cannot set arbitrary Authorization headers; browser
playback uses the HttpOnly session cookie instead. Native tokens returned by
pairing are not stored by the browser client.

## Native playback behavior

The playback response supplies the selected path, resume position, available
file versions, audio and subtitle tracks, trickplay metadata, and related
playback details. A native client can use those fields to build player controls
without reusing the web player's DOM components. For typical flows:

- Scrubbing: use byte-range requests for direct files and native HLS seeking
  for prepared HLS. Live remux/transcode streams are pipes, so resume or a long
  seek restarts the request with `start=<seconds>`.
- Audio: pass the selected audio index to the playback/stream request. The
  server maps it into the source and converts audio as needed.
- Subtitles: list tracks, then load the selected WebVTT URL. Embedded and
  sidecar track rendering must be supported by the native player or a native
  subtitle overlay.
- Trickplay: use the returned VTT and sprite URLs to implement a scrub preview.
- Quality: choose an alternate file version or prepared HLS variant when
  available. For a live transcode fallback, set `maxHeight` on the transcode
  URL to cap output resolution and bitrate.
- Offline source downloads: use the `versions` from the playback manifest to
  let the user choose a source file, then download that version through
  `/api/download/:fileId` with Bearer auth. The client owns local storage,
  download progress, resume, and deletion. If the desired source resolution is
  unavailable, ask whether to generate it and stream the result from the
  `maxHeight` download URL; this conversion is not resumable after disconnect.
- Progress: send periodic and lifecycle progress updates to `/api/progress`.

Expo Video is the recommended native decoder surface in the mobile app plan;
the React Native client will implement its own controls and use the same server
playback contract. Verify Bearer headers on HLS child requests, redirects, and
range requests on physical iOS and Android devices before relying on native
playback for release.

## Web connection addresses

When a phone and server share Wi-Fi, open the server's LAN URL on the phone,
such as `http://192.168.1.20:8765`. This loads the web client and API from the
same origin, avoiding HTTPS-to-HTTP mixed-content blocking. The server must be
bound to the LAN (`0.0.0.0`) and allowed through the host firewall.

A Cloudflare-hosted HTTPS page cannot call an ordinary `http://192.168...`
server because browsers block that mixed content. Cross-origin browser access
requires an HTTPS server URL, an exact frontend origin in
`PLEXY_ALLOWED_ORIGINS`, and a browser that accepts that server's certificate
and cross-site session cookie. A Cloudflare page is not a video relay.
