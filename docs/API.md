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
- `GET /api/download/:fileId` serves the existing source version as an
  attachment and supports `HEAD`/byte ranges so a native app can resume a local
  download. Quality-capped `?maxHeight=` downloads are **not implemented** in
  the current server.
- `GET /api/stream/:fileId/remux` and `/transcode` are compatibility routes
  that currently return `409`; live conversion is disabled. Playback uses the
  prepared MP4/audio-variant pipeline instead. There is no 2-transcode limit or
  `503`/`Retry-After` behavior.
- `GET /api/stream/:fileId/hls/:asset` is **not implemented**; the server never
  emits HLS. Prepared playback is MP4 only.
- `GET /api/subtitles/:fileId` lists subtitle tracks;
  `GET /api/subtitles/:fileId/:track` serves WebVTT.
- `GET /api/subtitles/:fileId/search?language=en` proxies OpenSubtitles search for
  the matched IMDb title; `POST /api/subtitles/:fileId/download` saves one result
  as a WebVTT track. Downloaded tracks then appear in the normal track list.
- `POST /api/progress` stores playback progress. The body accepts `paused` and
  the response returns `stop: true` when an administrator has stopped this
  session; clients should pause playback and show that the owner stopped it.

## Catalog, search, and collections

- `GET /api/home` returns the hero and all home rows (continue, next up,
  watchlist, favorites, recently added).
- `GET /api/items` accepts `kind`, `libraryId`, `q`, `genre`, `yearFrom`,
  `yearTo`, `minRating`, `maxRuntime`, `unwatched`, `watchlist`, `favorite`,
  `hidden`, `minUserRating`, `sort`, `limit`, and `offset`, and returns
  `{ items, total }`.
- `GET /api/items/:id` returns the title card, metadata, cast, trailer/extras,
  seasons/episodes, and the playable file. `GET /api/items/:id/similar` returns
  local genre/cast affinity recommendations.
- `GET /api/search?q=` searches titles, episodes, people, and genres through
  SQLite FTS5 (with a LIKE fallback) and returns grouped results.
- `GET /api/images/:artworkId` serves cached artwork. Omit `w` or pass
  `?w=original` for the full-resolution original; numeric values (up to 3840)
  request a display derivative. `?w=<pixels>&preview=1` returns a small
  placeholder immediately while the original is still downloading.
- `PUT /api/items/:id/flags` sets the signed-in user's `watchlist`, `favorite`,
  `hidden`, and 1–5 `rating` flags.
- `GET /api/history?limit=&offset=` lists the signed-in user's watched movies
  and episodes. `DELETE /api/history/:itemId` removes one entry (and its resume
  point); `DELETE /api/history` clears the account's history.
- `GET /api/collections` lists user collections plus read-only TMDB franchise
  groups (negative ids, `source: "tmdb"`); with `?itemId=` it only returns
  writable custom collections with membership. `POST /api/collections` creates
  one, `GET /api/collections/:id` returns its items, and
  `POST|DELETE /api/collections/:id/items[/:itemId]` adds or removes a title.
- `POST /api/libraries` accepts `language`; `PATCH /api/libraries/:id` accepts
  the same per-library metadata language. Changing it refreshes matched titles
  in the background.

## Sessions and administration

- `GET /api/admin/sessions` returns active and recently ended playback sessions
  (user, device, title, position, status, client, IP).
- `POST /api/admin/sessions/:id/stop` asks a live player to stop. The player
  acknowledges on its next progress heartbeat.
- `GET /api/auth/admin/devices` lists paired devices; `POST
  /api/auth/admin/devices/:id/revoke` signs one out and ends its live session;
  `DELETE /api/auth/admin/devices/:id` removes the revoked record.
- `GET /api/admin/trickplay/status` reports scrub-thumbnail coverage and the
  extraction queue; `POST /api/admin/trickplay/run` pre-generates every missing
  strip, including previous failures.

Native clients should attach Bearer auth to each media request. A browser
`<video>` element cannot set arbitrary Authorization headers; browser playback
uses the HttpOnly session cookie instead. Native tokens returned by pairing are
not stored by the browser client.

## Preparation settings

`PUT /api/settings` (loopback only) accepts the playback-preparation fields:

- `optimizeStorage`: `"data"` (default) or `"media"` for `.plexy/optimized`
  beside each original.
- `replaceOriginal`: replace the source with the verified MP4 after a
  successful preparation (default `false`).
- `moveOriginalsToTrash`: send removed originals to the system Trash instead of
  deleting permanently (default `true`).

See [playback preparation](PLAYBACK_PREPARATION.md) for the storage and
recovery behavior.

## Native playback behavior

The playback response supplies the selected path, resume position, available
file versions, chapters, audio and subtitle tracks, trickplay metadata, and related
playback details. A native client can use those fields to build player controls
without reusing the web player's DOM components. For typical flows:

- Scrubbing: use byte-range requests for direct/prepared MP4 files. Live
  remux/transcode streams are disabled in the current server.
- Audio: pass the selected audio index to the playback/stream request. The
  server maps it into the source and converts audio as needed.
- Subtitles: list tracks, then load the selected WebVTT URL. Embedded and
  sidecar track rendering must be supported by the native player or a native
  subtitle overlay.
- Trickplay: use the returned VTT and sprite URLs to implement a scrub preview.
- Quality: choose an alternate file version from the playback manifest. HLS
  variants and live `maxHeight` transcodes are not implemented.
- Offline source downloads: use the `versions` from the playback manifest to
  let the user choose a source file, then download that version through
  `/api/download/:fileId` with Bearer auth. The client owns local storage,
  download progress, resume, and deletion.
- Progress: send periodic and lifecycle progress updates to `/api/progress`.

Expo Video is the recommended native decoder surface in the mobile app plan;
the React Native client will implement its own controls and use the same server
playback contract. Verify Bearer headers, redirects, and range requests on
physical iOS and Android devices before relying on native playback for release.

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
