# Plexy feature audit: desktop, mobile, backend

> **Status note (20 Nov 2026):** some rows below are stale. In particular, the
> server does not implement HLS, `maxHeight` generated downloads, live
> remux/transcode, or the 2-transcode limit, and mobile “saved” online titles are
> bookmarks rather than downloads. See `docs/APP_FEATURE_AUDIT.md` for the
> current code-level audit.

This audit compares what ships in each app and turns the gaps into a desktop roadmap.
It reflects the code in `apps/server`, `apps/web` (the UI the desktop app hosts), `apps/desktop`
(the Electron shell), and `apps/mobile`.

## How the pieces relate

| Piece | What it is | Who it is for |
| --- | --- | --- |
| **Backend** (`apps/server`) | Bun/Elysia server, SQLite catalog, scanner, TMDB matcher, FFmpeg preparation, auth, mDNS/TLS, diagnostics | The machine that owns the media files |
| **Desktop** (`apps/desktop` + `apps/web`) | Electron shell with a child backend (or a client to a remote Plexy server) and the React UI. Native mpv player for originals. | A Mac/PC on the same network or the server machine |
| **Mobile** (`apps/mobile`) | Independent Expo/React Native app with its own on-device SQLite catalog and `expo-video` player | Android phone/tablet, often offline |

Mobile is **not** a Plexy-server client by default. Its "online" side is a third-party catalog
(`features/remote`), while local mode scans folders on the device. Desktop is the server's client
and the only place where the full admin surface is available.

## Feature matrix

### Library and catalog

| Capability | Backend | Desktop | Mobile |
| --- | --- | --- | --- |
| Scan local folders into a catalogue | Yes | Admin UI (`LibrariesPanel`) | Yes, on-device (`settings/folders`) |
| Movies / TV grouping, seasons, episodes | Yes | Yes (`routes/title/$itemId`) | Yes |
| TMDB matching, manual rematch, artwork | Yes | Fix matches (`MatchesPanel`) | Metadata settings (`settings/metadata`) |
| Title / cast / trailer detail page | Yes | Yes | Yes |
| Search | Yes (titles + episodes) | Yes (`routes/search`) | Yes |
| Sort | Yes | Recently added / alphabetical / year / rating | Recently added / name / year / rating |
| Filters | Library / kind / unwatched API | Kind only (UI) | Unwatched, offline only |
| Collections | No | No | Yes |
| Continue watching / next up | Yes (`/api/home`) | Yes | Yes |
| Watchlist | No (per-device browser flag) | Hero + title flag, no browse page | Title flag |
| Hidden titles | No | No | Yes |
| Kids / family mode with PIN | Account `maxAge` only | Maturity limit only | Yes (`family-settings`, `pin-dialog`) |
| Multi-user accounts, roles, access rules | Yes | Yes (`user-management`) | No (single device library) |

### Playback

| Capability | Backend | Desktop browser player | Desktop native mpv | Mobile |
| --- | --- | --- | --- | --- |
| Direct stream with range seeking | Yes | Yes | Yes | Local file |
| Prepared MP4 remux / transcode | Yes | Yes | Not needed (original) | Local codecs only |
| Resume position | Yes | Yes | Yes | Yes |
| Audio tracks | Yes | Yes | Yes | Yes |
| Subtitles | Embedded + sidecar + WebVTT + cache | Embedded, sidecar, styling, sync, position | Same via Video.js chrome | Embedded + **import SRT/VTT**, timing, size, placement |
| Skip intro / recap / credits | IntroDB + community markers | Yes | Yes | Yes (`autoSkip`) |
| Next episode | Yes | Prompt + button | Prompt + button | Toolbar button, auto-next setting |
| Playback speed | No | Menu | Menu | Speed panel |
| Picture in picture / cast / AirPlay | No | PiP, cast, AirPlay buttons | OS-level mpv window | PiP |
| Fit modes (contain / cover / stretch) | No | No | mpv keeps aspect | Yes |
| Screen lock | No | No | No | Yes |
| Gestures / hotkeys | No | Yes (seek, volume, fullscreen) | Yes + arrow seek | Yes (tap/double-tap, volume/brightness) |
| Stats for nerds | Yes | Yes | No | Diagnostics settings |
| Offline downloads | Download endpoint with `maxHeight` | No download UI | No | Downloads/saves online titles |

### Settings and operations

| Capability | Desktop | Mobile |
| --- | --- | --- |
| Overview / account / password / avatar | Yes | No accounts |
| Subtitle + audio defaults | Yes | Yes (incl. per-show tracks) |
| Playback diagnostics consent | Yes | No |
| Paired devices, pairing codes, certificate | Yes | No |
| Appearance (light/dark/system) | Yes | Yes + appearance mode selector |
| Add/edit/rescan/remove libraries | Yes | Local folders + scan + report |
| Match repair | Yes | Metadata refresh + test connection |
| Server preferences: metadata, LAN/TLS, prep, optimizer, offline cache, updates | Yes | Local equivalents: metadata, markers, updates, licenses |
| Logs, crashes, system usage, update download | Yes | Update check/download, licenses, library report |
| Server process controls | Desktop shell toggles local backend | N/A |
| Remote server switching | Yes (`/connect`, proxy) | No (online catalog only) |

### Desktop shell

| Capability | Present |
| --- | --- |
| App menu, updater with checksum verification, certificate trust | Yes |
| Native folder picker for adding a library | Yes |
| mpv native player + loopback relay | Yes |
| Run local server toggle / act as client to a remote Plexy | Yes |
| Traffic-light-aware chrome, fullscreen | Yes |
| Tray, global media keys, drag-and-drop import, multi-window | No |

## What the desktop should take from mobile

1. **Offline downloads (P1).** The backend already exposes quality-capped downloads. Desktop is the
   natural place for a "Download for offline" action and a downloads screen; a laptop that leaves the
   LAN should still play what it queued.
2. **Kids / family profile (P1).** Mobile has a PIN-gated family level, unrated-title blocking, and a
   region for certifications. Desktop only shows a static maturity limit read from the account.
3. **Hidden titles (P1).** Mobile lets a viewer hide titles from every row. Desktop needs the same
   flag or, better, a server-side per-user hidden list so it follows the profile across devices.
4. **Watchlist browse page (P1).** The desktop already stores per-title watchlist flags in
   `localStorage`; there is no screen to see them. A "Watchlist" row or library filter closes the loop.
5. **Richer library filters (P2).** Mobile has unwatched-only and offline-only filters. Desktop
   should add unwatched, genre, year, and collection filters to the library grid.
6. **Subtitle import and fit modes (P2).** Mobile can add a local SRT/VTT and switch contain/cover/
   stretch. The desktop browser player has track selection but no import, and no fit control.
7. **Per-show track memory (P2).** Mobile remembers audio/subtitle choices per show. Desktop
   remembers language defaults but not per-series overrides.
8. **Sleep timer / autoplay episode picker (P2).** Mobile has a sleep timer and an episode picker;
   the desktop next-episode prompt is good but a countdown and a cancel action would match it.

## What is better for the desktop and the big screen

1. **Keyboard-first navigation.** `⌘K` search exists, and the player has hotkeys. Add spatial
   navigation (arrow keys move focus between nav, rows, and actions), `g h` / `g l` / `g s`, and a
   visible shortcut sheet. This is the single biggest living-room win.
2. **A 10-foot mode.** Larger type and poster captions, bigger focus rings, fewer controls per
   screen, a focusable hero action row. Everything is currently sized for a laptop at 1× scaling.
3. **Continue-watching first.** On a TV or big monitor, "Continue watching" belongs above (or merged
   into) the featured carousel; the hero should prefer the in-progress title when one exists.
4. **Autoplay next with a visible countdown.** Desktop has the button; a 10-second countdown with
   "Cancel" is the big-screen convention and removes a remote-control step.
5. **Muted trailer or motion previews on focus.** The hero is static art today. A muted, short
   preview on focus (and on card hover) is appropriate here because this is a media product, not a
   cafe site; it must respect reduced motion and pause immediately.
6. **Bigger captions and a subtitle background.** Distance viewing needs a caption size and edge
   style preset that persists per device.
7. **Media keys and a sleep timer.** Play/pause/next from the keyboard, headphones, or remote.
8. **PiP and multi-window.** The player already offers PiP; a detached mini-player or second window
   makes a desktop feel like a desktop.

## Extra desktop features worth adding

1. **Download queue and offline mode (P0/P1).** Pair with the backend's download endpoint, show
   progress, and let the library mark downloaded titles.
2. **Drag-and-drop folders onto the window** to start the add-library flow, with the native folder
   picker as the fallback.
3. **Server switcher / profile menu in the header.** The desktop can already act as a client to a
   remote server; make switching explicit instead of hiding it in `/connect`.
4. **Watchlist page and "Saved" row.**
5. **Tray player / mini-player with media keys** (menu-bar aware), plus a "close to tray" preference.
6. **Keyboard shortcut cheatsheet** (`?`) and a first-run overlay for the player.
7. **Library maintenance shortcuts:** reveal file in Finder/Explorer, copy path, open library folder,
   open logs folder. These exist in the backend/desktop APIs but are not exposed as first-class UI.
8. **Diagnostics export.** One button that bundles logs, crashes, playback diagnostics, and server
   usage into a shareable file.
9. **Remote quality cap per title.** Ask the prep pipeline for a maximum height when the connection is
   slow, instead of a server-wide default.
10. **Focus mode in the player** (hide chrome until pointer move) and a "next up" queue panel.

## Priority order

| Priority | Work | Why |
| --- | --- | --- |
| P0 | Keyboard/spatial navigation + 10-foot type scale + continue-watching first + autoplay countdown | Makes the desktop app usable from a couch and a keyboard without a pointer |
| P1 | Offline downloads, watchlist page, family PIN mode, hidden titles, server switcher | Closes the largest functional gaps with mobile and remote servers |
| P1 | Bigger captions, subtitle import, subtitle background, sleep timer | Playback parity with mobile and distance viewing |
| P2 | Collections, richer filters, drag-and-drop import, tray/media keys, diagnostics export | Quality-of-life work after the core experience is solid |
