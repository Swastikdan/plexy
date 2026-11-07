# Plexy Android mobile and TV clients

Two React Native applications now live in `apps/mobile` and `apps/tv`. They connect to the existing Plexy Server; neither bundles or launches a server. Shared code lives in `packages/native-client`. The visual tokens come from the checked-in web app: flat dark surfaces, Geist typography, white actions, artwork rows and custom player overlays.

This is an implementation for device evaluation. Native compilation and JavaScript checks do not establish complete playback, visual or remote-input parity on real devices. The device release checklist below remains open.

## Run locally

Use Bun from the repository root, Node LTS supported by Expo, JDK 17, Android SDK platform/build tools 36, and an Android device/emulator. The selected native dependencies currently require Android API 24 or later. Expo Go cannot run the TV runtime or the casting module.

```sh
bun install --frozen-lockfile
bun run android:mobile
# Or target an Android TV emulator/device:
bun run android:tv
```

`expo run:android` generates native code, compiles and launches the app with Metro. Run mobile and TV separately, or assign different Metro ports when running both. `bun run dev:mobile` and `bun run dev:tv` start Metro for an already installed development app; open that app directly rather than using Expo Go. With a USB-connected device, `adb reverse tcp:8081 tcp:8081` allows the development app to reach Metro on the host.

For standalone internal-test APKs that include the JavaScript bundle and do not need Metro:

```sh
bun run build:native:preview all
# Or: bun run build:native:preview mobile
# Or: bun run build:native:preview tv
```

The script generates native projects and builds release-mode, **debug-key-signed internal previews**, copying them to `.build/native/plexy-mobile-preview.apk` and `.build/native/plexy-tv-preview.apk`. These are not production signing identities or store submissions. Prebuild regenerates the ignored Android directories; keep native configuration changes in config plugins, not generated files. The shared-build-inputs plugin also makes Gradle track changes in `packages/native-client/src` when deciding whether to regenerate an app bundle. Default previews contain `arm64-v8a`; set `PLEXY_ANDROID_ARCHITECTURES=armeabi-v7a,arm64-v8a` for both ARM architectures, or the emulator architecture you need. `PLEXY_GRADLE_BINARY` optionally selects an installed compatible Gradle executable instead of the wrapper.

Install the appropriate preview with `adb install -r <apk-path>` or transfer it to the Android device and open it using its APK installer. Mobile uses application ID `app.plexy.mobile`; TV uses `app.plexy.tv` with a Leanback launcher, TV banner and no touchscreen requirement.

## Server connection

Finish server setup and create an account in the existing Plexy server/web app. Enter the server address in the native app, then sign in or redeem a pairing key. Pairing keys can also be generated from native Settings after password confirmation. Credentials are stored with Android-backed Expo SecureStore; catalog, preferences, progress and downloaded files are scoped by stable server ID **and account ID**.

On the connection screen, **Find servers on this network** browses the server's `_plexy._tcp` mDNS advertisements using Android's native NSD API. Discovery runs automatically when the screen opens and can be retried. It holds a Wi-Fi multicast lock during the bounded search and releases it afterwards. Enable LAN access on the server; guest Wi-Fi, router client isolation or multicast filtering can prevent discovery even when devices have internet access. Manual addresses remain supported.

LAN connections use HTTPS. Entering `http://192.168.1.240:<port>` is resolved natively to HTTPS on that port or the next port (Plexy's default LAN HTTPS listener is the local HTTP port + 1). This happens before fetch or authentication, avoiding Android's cleartext failure without sending passwords or device tokens over LAN HTTP. Discovery uses the server's advertised HTTPS port directly, including a custom LAN port.

When Plexy Server uses a self-signed local certificate, choose Connect, compare the shown SHA-256 fingerprint with the fingerprint on the server computer/in the existing Plexy account settings, then choose **Fingerprints match — trust server** and Connect again. The inspection performs only a TLS handshake, sends no HTTP request or credentials, and checks the certificate address and validity. Approval is saved in private app storage and applies to API/artwork, native video/HLS and native downloads. Only the exact approved certificate is added to normal system-root trust; hostname checks remain enabled. An unapproved replacement/expired certificate is rejected. Remote servers still require publicly trusted HTTPS; local approval is restricted to private-network addresses.

The HTTP development option now applies to loopback connections only. For USB development, forward the server's actual local port using `adb reverse tcp:<port> tcp:<port>` and enter `http://localhost:<port>` with that option selected. Android keeps application-wide cleartext disabled. `PLEXY_LAN_HOSTS` can add exact build-time development host exceptions, but does not bypass the server's HTTPS policy. Chromecast has its own certificate trust store; approving a certificate in the Android app does not make it trusted by a Cast receiver.

Deploy the server from this same source revision for safe resumable downloads. The client uses authenticated `GET /api/download/:fileId/info` for source size/ETag and `If-Range` on the byte transfer. Older servers without this metadata endpoint need updating for native source downloads. No filesystem path or credential is included in this response.

## Implemented surfaces

| Surface | Behavior in source |
| --- | --- |
| Connection/account | Saved server/account profiles, pairing or password login, switch/remove connection, pairing-key creation, certificate fingerprint, device revocation/removal, password change and sign-out with a download retention choice |
| Home/library | Server-provided hero and rows, posters, watch state, movies/shows, sorting, unwatched filter, incremental loading, empty/error/retry states |
| Search/details | Debounced cancellable search, title/episode results, synopsis, metadata, cast, seasons/episodes, available media facts, watched state and progress clearing; YouTube trailers open externally |
| Player | Native video surface with custom controls, play/pause, ±10 seconds, touch/remote scrubbing, elapsed/remaining time, resume/restart, subtitle selection/off/timing/placement/size, server audio-track selection, speed/volume, source versions/HLS variants/conversion caps, skip markers, next-episode countdown, recovery and diagnostics |
| Mobile fullscreen | Custom fullscreen layout, landscape lock in either direction, hidden system bars and serialized restoration of the pre-player orientation policy on exit/unmount; no switch to a default native fullscreen UI |
| TV | Separate landscape composition and navigation rail, larger type/cards/actions, visible focus, native focus guides, media-key handling and remote scrub focus |
| Offline | Persistent queue/index in app-private storage, source range resume with source-change protection, explicit generated-quality consent, generated restart behavior, pause/retry/cancel/delete, storage limits, Wi-Fi/Ethernet preference, local playback and progress reconciliation |
| Catalog cache | Up to 30 scoped catalog responses for connectivity failures, an offline-catalog notice and Settings cache clearing; authorization failures are not served from cache |

The server still owns scanning, matching, administration, media conversion, metadata, permissions and watch state. Administrators can manage server preferences, browse server folders, create/edit/remove libraries, scan media, manage users and content rules, revoke devices across accounts, correct matches, prepare media, inspect logs/crashes, and reset indexed library data from native Settings. These controls use the same authenticated HTTPS API as the desktop client; ordinary accounts retain only their personal account/device controls. Desktop-only operating-system actions, such as restarting the host or installing a desktop update, remain on that computer. No collections/watchlists were identified in the current reference routes, so there are no invented collections/watchlist endpoints.

## Casting

Mobile includes a Google Cast sender and the optional trusted receiver source in `packages/native-client/cast-receiver`. Casting is disabled in default builds until a custom receiver is configured; the stock Google receiver cannot attach Plexy's Bearer headers. TV playback itself does not require casting or receiver registration.

To enable it:

1. Host the receiver's `index.html` and `receiver.js` together on a trusted HTTPS origin you control. The receiver handles a Plexy credential in memory, so treat this origin as trusted application code. Do not add third-party analytics or credential logging.
2. Register that URL as a custom Web Receiver in the Google Cast developer console and configure test devices as required there. Keep the receiver private to your project until validated.
3. Add that exact receiver origin to the separately deployed server's `PLEXY_ALLOWED_ORIGINS` allow-list. Ensure the Cast device can reach and trust the server's HTTPS address.
4. Set `PLEXY_CAST_RECEIVER_ID=<custom receiver app ID>` when generating/building the mobile app. Use the same value in the EAS environment if building there. Rebuild the native binary after changing this ID.
5. In the player, choose a Cast device, then choose **Play on TV**. The token travels in Cast's LOAD credentials field, never the media URL or metadata. The receiver applies headers to same-server manifest/segment requests, removes credentials from the load payload and reports progress to the server.

Current sender support is direct files and prepared HLS. Prepare titles that currently require live remux/transcode before casting. Receiver playback controls support play/pause, seek and stop; the receiver does not reproduce all advanced native subtitle/skip/next-episode UI. Leaving the native player stops its Cast session. Verify real hardware and the receiver SDK's request-header behavior before enabling this in a distributed build.

## Downloads and playback limits

Transfers pause when the app leaves the foreground. Source files can resume from their saved byte count after an interruption/process restart when the source validator matches; a changed representation restarts safely. Generated-quality files stream a live conversion and always restart after interruption. This does not implement an Android foreground-service download worker that continues after the app is killed.

Downloads remain private to the app. Keeping downloads on sign-out allows the same account to reconnect and use them later; they are not exposed to another account. Completed media is not automatically evicted. Optional subtitles are saved alongside the download index when available; missing subtitle downloads do not invalidate the media file. Offline artwork and trickplay sprite caching are not implemented.

Server capability negotiation currently uses conservative H.264/VP8/VP9 and AAC/MP3/Opus/FLAC assumptions. This can select server conversion on a device that could decode HEVC/AV1/HDR directly; hardware capability probing and HDR/audio passthrough need device-specific work. Subtitle rendering covers the server's WebVTT text output, not image/ASS styling fidelity. PiP is exposed only on supported mobile devices and still needs device validation. AirPlay/iOS/Apple TV/Tizen/webOS are outside this Android scope.

## Checks and device release gates

Automated commands:

```sh
bun run typecheck:native
bun run test:native
# After compiling mobile: real TLS tests using the compiled Kotlin trust classes
JAVA_HOME=<JDK-17-path> bun run test:native:tls
bun run bundle:native
bun run typecheck
bun run test:server
```

The native tests cover credential boundaries, API contracts, live-conversion offsets, subtitle/trickplay parsing, transfer integrity, queue persistence/pause/resume, offline progress races, Cast receiver authorization and LAN address/error policies. The additional JVM TLS harness uses the actual compiled Kotlin trust manager with in-memory Android storage adapters and real OkHttp/TLS sockets: it verifies rejection before approval, approval in existing and independent clients, preservation of ordinary root trust, hostname rejection and trust removal. Android NSD and the Android system-root initialization path still need a device check. Both mobile and TV Android debug and standalone preview builds have compiled successfully on this machine. The generated preview APKs are under `.build/native/`, contain their JavaScript bundles, and target ARM64 Android API 24+ (target SDK 36). No phone/TV/Cast device was connected for this implementation run.

Before declaring release parity, record device/Android/app/server versions and results for:

- [ ] Pair, reconnect, switch accounts, revoke a session and recover without mixing cached/downloaded data.
- [ ] Direct, prepared HLS and live-converted playback with authorization on nested playlists, segments, seeks and redirects.
- [ ] Multiple audio tracks, external/embedded text subtitles, timing/placement, source/quality changes and media failures.
- [ ] Mobile fullscreen entry/exit, both landscape directions, Back, system chrome, interruption/background/resume and PiP.
- [ ] Remote-only TV pairing, rail/grid/menu traversal, focus restoration, timeline seeking, media keys, Back and long libraries.
- [ ] Compare home, library, details and player against the web reference with identical titles/artwork/state at actual phone/tablet/TV resolutions.
- [ ] Source download interruption/resume, source change, generated interruption/retry, low storage, process restart, offline progress and deletion on both targets.
- [ ] Configure and exercise the custom Cast receiver on physical hardware if distributing casting support.
- [ ] TalkBack, large font scale and touch targets; TV readable-distance and overscan checks. Labels currently ship in English.
- [ ] Fire TV physical-device compatibility before advertising Fire TV support.

## Production distribution

Each app has development, preview and production profiles in its own `eas.json`. Initialize each app's EAS project under the intended owner's account, configure signing credentials and the receiver environment where relevant, then build from that app's directory:

```sh
# Within apps/mobile or apps/tv:
bunx eas-cli build --platform android --profile preview
bunx eas-cli build --platform android --profile production
```

Preview profiles produce APKs; production profiles produce AABs. Keep the signing key identity stable across updates, increment Android `versionCode`, and submit to internal/closed testing before production. Store signing, privacy/store text, screenshots, review-server instructions and current Google Play/TV requirements remain release-owner work; no cloud build, store listing or publication was performed here.

References: [Expo TV setup](https://docs.expo.dev/guides/building-for-tv/), [Expo Video](https://docs.expo.dev/versions/v57.0.0/sdk/video/), [Google Cast setup](https://react-native-google-cast.github.io/docs/getting-started/setup), [custom receiver features](https://developers.google.com/cast/docs/web_receiver/core_features).

LAN discovery API reference: [Android NsdManager and multicast reception](https://developer.android.com/reference/android/net/nsd/NsdManager). Updated preview version: **1.0.2**, Android version code **3**. Install over the earlier preview to keep device data.

## Authentication HTTP 500 with an existing account

If password login or desktop pairing-key creation returns HTTP 500 with a backend `UnsupportedAlgorithm` error, an older database may hold an encoded password hash as a SQLite BLOB. Applying `String(...)` to the returned byte array does not decode the hash; it produces byte numbers and breaks password verification. Migration `014_password_hash_text.sql` preserves the encoded bytes while normalizing recognized hashes to TEXT. The backend also decodes existing binary hashes safely and returns an authentication failure for malformed hashes. Accounts, passwords, sessions and libraries are retained; this is a backend/database repair and does not require replacing the Android APK.

### Incorrect password versus an expired Android session

Pairing-key creation confirms the password of the current Plexy account, not the Mac login password or an Android device PIN. A rejected login/pairing request must display its server error; it is not an expired-session condition. Native preview 1.0.2 (version code 3) preserves those errors, while a revoked token on a protected API still asks the user to reconnect. A password recovery changes account credentials and invalidates that account's sessions and unused pairing keys; it does not remove media, the library or watch progress.
