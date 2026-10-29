# Backend and Remote Playback Reliability Plan

## Current architecture

- Cloudflare Workers serves the static web client. It does not host Plexy's
  library database or relay playback by itself.
- The Plexy server owns the library, auth state, and media files. The web client
  connects directly to the server address saved on that device.
- LAN access is opt-in and binds to `0.0.0.0`; the default bind is loopback.
- API routes require a paired device credential. Stream, subtitle, artwork,
  and HLS requests use the HttpOnly session cookie.
- This turn tightens the auth boundary: cross-origin cookies now require an
  exact configured origin, owner-only routes reject reverse-proxied loopback,
  pairing codes are claimed atomically, and tokens in URLs are no longer
  accepted.

## Phase 1: Make connection setup predictable — implemented

1. Keep the saved server URL as a per-device setting and validate it with the
   Plexy status endpoint before switching the active server.
2. On the same Wi-Fi, tell users to open the server's LAN URL directly. Show a
   clear firewall, LAN binding, and pairing checklist when the probe fails.
3. For cross-origin HTTPS web clients, configure
   `PLEXY_ALLOWED_ORIGINS` with exact frontend origins. Do not use a public
   Cloudflare hostname as a video relay; use a private network for remote
   playback.
4. Add a connection state that distinguishes offline, unauthorized, and
   server-up-but-unavailable, with a retry action that preserves the entered
   server and library state.

**Done when:** a phone can connect to a server by LAN URL, pair once, reload,
and retain its session; invalid addresses and blocked HTTPS-to-HTTP requests
show a specific next step.

## Phase 2: Improve API resilience and diagnostics — implemented

1. Add bounded request timeouts and retry only safe idempotent metadata reads.
   Never automatically retry mutations or pairing submissions.
2. Use a shared connection-health monitor to avoid repeated probes during an
   outage and to resume queries after the server returns.
3. Add request IDs and structured timing/error fields to server logs; redact
   credentials and avoid logging media paths or query secrets.
4. Add an admin diagnostic view for server version, selected client/API URL,
   paired session context, and recent stream failures. Playback event sharing
   is disabled unless enabled on that client; the server keeps only the last
   100 events in memory and events omit media paths.

**Done when:** temporary Wi-Fi loss recovers without a reload, users can tell
whether the fault is reachability, authentication, or playback, and logs
identify the failing request without exposing credentials.

## Phase 3: Stabilize media delivery — partial

1. Validate the existing range/HLS/disconnect paths with server tests. A real
   codec and network matrix still requires device-level playback testing.
2. Ensure HLS segments and playlist rewrites remain on the configured server
   origin and preserve credentials without putting long-lived tokens in URLs.
3. Limit live remux/transcode FFmpeg jobs to two concurrent conversions and
   terminate the child when its response is cancelled.
4. Add playback telemetry that records startup delay, rebuffer count, selected
   path, and terminal error locally; make reporting opt-in before any remote
   collection.

**Done when:** direct, remux, transcode, and prepared HLS playback recover from
brief network interruptions and release all child processes after disconnect.

## Phase 4: Prepare the server for a native mobile client — server groundwork

1. Document pairing, catalog, playback, subtitle, and progress endpoint
   contracts in `docs/API.md`; shared response types remain in
   `@plexy/api-client`.
2. The server already issues revocable per-device bearer credentials. A native
   app still needs to store them in its platform credential store and attach
   them to API and media requests.
3. Expose a persisted opaque `serverId` in status and pairing responses;
   clients should pin/confirm it. Device revocation is available. Native
   identity confirmation and token rotation UX remain mobile-client work.
4. LAN and private-network remote flows, address changes, server restarts, and
   background/foreground transitions remain to be exercised by a native
   client.

**Done when:** the mobile app can pair, reconnect to the same host after a
network change, stream, and be revoked independently without weakening browser
authentication.

## Network choice for personal remote playback

Use a direct LAN address while phone and server share Wi-Fi. For access away
from home, prefer a private network such as Tailscale or WireGuard. A public
Cloudflare Tunnel hostname routes traffic through Cloudflare; Cloudflare's
current service terms restrict video and large-file delivery over public
hostnames on Free, Pro, and Business plans. Private-network routes are the
appropriate route for personal video traffic under those terms.
