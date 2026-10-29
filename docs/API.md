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
- `GET /api/stream/:fileId/remux` and `/transcode` provide live conversion
  fallbacks. Live conversions are limited to two at a time; excess requests
  receive `503` and `Retry-After`.
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
