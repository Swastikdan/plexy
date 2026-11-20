# Plexy UI inventory

Complete catalogue of every screen and visual state in the three Plexy surfaces.
Compiled from a read-only pass over `apps/web`, `apps/desktop`, and
`apps/mobile` on 19 November 2026.

**Counts**

| Surface | Screens | Distinct visual states |
| --- | --- | --- |
| Web (`apps/web`) | 24 | 328 |
| Desktop shell (`apps/desktop`) | shares web screens + 13 shell-only surfaces | 15+ player/shell states |
| Mobile (`apps/mobile`) | 24 | 214 |
| **Total** | **48 screens** | **542+ states** |

A “screen” is a routable page, a persistent settings panel, or a distinct auth
or player shell. Modal phases and wizard steps count as states. Shared
component states (hover, focus, selected) are counted once per screen family.

---

## 1. Web (`apps/web`)

Routes live in `apps/web/src/routes/`. Settings tabs are `?tab=` panels, not
separate routes.

### Shell and gate

| Screen | States |
| --- | --- |
| App shell (`__root.tsx`, `topnav.tsx`, `bottomnav.tsx`) | boot splash; connection splash; offline banner; API-failure banner; retry in progress; local-only server; local library unavailable; skip-link focus; header at scroll top; header scrolled; nav item active; mobile bottom-nav active |
| Server gate (`server-gate.tsx`) | signed out → sign-in; signed out → pair; checking session; server unreachable; cookie-blocked error; local-only; authenticated |
| Not-found / errors | TanStack default 404; default route error; no global error boundary |

### Content

| Screen | Route | States |
| --- | --- | --- |
| Home | `/` | skeleton; error; empty-admin; empty-viewer; populated; rows only; single hero; multi-slide hero; paused hero; logo vs text title; Play / Continue / Details; watchlist selected; row without overflow; row left arrow; row right arrow; “See all” hover; poster hover/focus; no-art fallback; progress bar; wide-card menu; menu-open |
| Library | `/library/:kind` | skeleton; error; empty all; empty movies; empty TV; populated grid; kind tabs; active tab; sort popover; scan running; background refetch; shared card states |
| Search | `/search?q=` | idle skeleton; idle with continue row; idle with recent row; idle empty; field busy; field idle; first-query skeleton; no matches; movies/series results; episodes results; both sections; updating with data; singular heading; sticky bar scrolled; shared result states; **no error state (gap)** |
| Title | `/title/:itemId` | skeleton; not found; logo hero; text hero; no backdrop; back-to-series; unmatched banner; partial meta; rating row; no overview; Play; Resume; Watch again; Play disabled; no trailer; watched selected; watchlist selected; favourite selected; more menu; refresh pending/error/success; season selector; next-unplayed highlight; episode hover; episode progress; episode watched controls; empty season; cast collapsed/expanded; cast fallback; file details; trailer overlay; fix-match modal (movie/TV, searching, results, empty, error); delete modal (default, pending, error) |
| Person | `/person/:personId` | loading; error; populated; photo fallback; empty credits; count wording |

### Player

| Screen | States |
| --- | --- |
| Browser player (`/watch/:fileId`) | opening; manifest error; preparing-running; preparing-queued; preparation failed; buffering; controls visible; controls hidden; top bar; play/pause/restart; volume popover; mute/volume indicator; timeline idle/buffered/dragging/chapters; trickplay loading/loaded/chapter; status chips; double-tap seek; settings menu; quality submenu; audio menu; audio submenu; captions submenu; speed submenu; subtitle sync; subtitle position; context menu; stats overlay; next-episode prompt; skip segment; fullscreen; PiP; cast/AirPlay; media error; poster before first frame; ended; mobile control layout |
| Desktop native player | opening original; fatal card; manifest error; engine unavailable; controls visible/hidden; top bar with traffic lights; buffering; audio menu; settings menu; skip segment; next-episode; finished; native fullscreen; transparent page; error dialog |

### Settings and auth

| Screen | Route/tab | States |
| --- | --- | --- |
| Settings shell | `/settings?tab=` | desktop sidebar; mobile tab strip; admin group; non-admin group; deep-link fallback; legacy tab mapping |
| Overview | `overview` | profile loading; admin; viewer; avatar hover; stat tiles; libraries loading; libraries empty; libraries populated; quick actions; server health online/connecting |
| Account | `account` | details loading/loaded; photo absent/present/saving/error; password default/error/submitting; sign out; manage users |
| Playback | `playback` | subtitles off/on; language select; admin audio section; diagnostics off/on |
| Devices | `devices` | no code; creating; code shown; copied; code error; this device loading/loaded; paired list; current tag; revoked row; empty; sign out; certificate |
| Appearance | `appearance` | light; dark; system; hover; reduced-motion note |
| Libraries | `libraries` (server) | loading; restricted; empty; populated; row scanning; rescan disabled; remove; remove error; configure modal |
| Fix matches | `matches` | loading; restricted; filters; truncation; search; empty filter; empty search; row badges; remap/fix; modal results; searching; empty TMDB; search error; apply disabled/error; auto candidates |
| Users | `users` | loading; error; empty; roster; create modal; validation; creating; error; edit self; edit other; rules loading/error; no rules; rule rows; add permission; saving; save error |
| Server | `server` | 50 states: loading; restricted; local-server on/off/busy/error; update idle/checking/available/up-to-date/unsupported/downloading/verifying/approval/installing; system usage; live graphs; metadata accordion; TMDB status; token warning; language/region/image; clear cache; test success/failure; skip markers; network; LAN URLs; diagnostics; optimizer; storage; offline cache; maintenance; reset phrase; crash reports; logs |
| Setup | `/setup` | 18 states: loading; checking; blocked; owner form; mismatch; API error; creating; connected starts; needs verification; token required; test failure; manual token; type cards; folder browser (loading/unreadable/empty/badges); ready; LAN copy; finish pending/success/error; mobile rail |
| Connect | `/connect` | 13 states: default; invalid; checking; probe error; connected; mixed content; same-origin suggestion; tried note; desktop discovery; discovered rows; browser note; local toggle; back |
| Add library | `/add-library` | 13 states: step 1; selected type; step rail; folder loading; read error; empty folder; media badges; shortcut selected; native picker; custom path open; name/summary; submit busy; error |
| Sign in | gate | password mode; busy; auth error; invalid fields; choose another server |
| Pair device | gate | pair mode; incomplete code; busy/error; help |
| Desktop shell | `apps/desktop` | startup local; backend failed; static-only; both failed; local toggle; hidden inset; mpv surface; native fullscreen; update card/dialogs; menus |

### Web state gaps that matter for parity

1. No custom 404 or error boundary.
2. Search failure renders a blank results area.
3. Library and search errors have no retry.
4. No toast/undo system; feedback is inline only.
5. No drawers/sheets; destructive actions use `window.confirm` in places.
6. No fit/cover/zoom control in the browser player.
7. Overview stat tiles show `0` while loading instead of skeletons.

---

## 2. Mobile (`apps/mobile`)

Routes live in `apps/mobile/src/app/`. Every screen has a feature entry under
`src/features/`.

### Global

| Surface | States |
| --- | --- |
| Boot | font spinner; local runtime restore failure; device-storage failure |
| First-run gate | onboarding replaces tabs |
| Tab bar | 4 tabs; settings attention dot |
| Updates | bootstrap loading; required gate; feature gate; optional modal; downloading; ready; error; offline |
| App dialog | default; selected; destructive; busy |
| Notices | inline error; success; warning |

### Screens

| Screen | States |
| --- | --- |
| Onboarding / watching mode | mode step; local no folders; local folders; hybrid no folders; hybrid folders; online; busy; folder error |
| Home | skeleton; local error; online error; offline; populated; empty local; empty family; inline online error; pull-to-refresh |
| Libraries | grid skeleton; error; empty local; empty online; no filter match; populated; collections; collections empty; collection browser; sort/filter sheet; active filters; genre dialog; runtime dialog; pagination; offline-only empty |
| Search | landing skeleton; landing error; landing offline; landing populated; nothing trending; partial errors; searching skeleton; results + pending; results populated; partial error; no results; family no results; search error; offline |
| Settings root | populated; update checking; update available; downloading; action message; library issues; offline |
| Media folders | no folders; list; folder titles; files; pagination; kind dialog; remove confirm; busy/error |
| Metadata & markers | default; refreshing; success; markers refreshing/result; offline; choice modal |
| Playback | local sections; online-only; hybrid; language picker; seek dialog |
| Kids & family | default/off; active limit; level dialog; rating system; set PIN; verify PIN |
| Hidden titles | empty; populated + restore all |
| App updates | reading version; up to date; available; downloading; result/error; offline |
| Scan library | folder list; no folders; progress card; error; issues; disabled |
| Open-source licenses | collapsed groups; expanded group; search; no matches; package detail; license text; error |
| Library report | all; review; files; empty review; empty all/files; adding files; message; remove confirm; identify (movie form, TV form, searching, results, no matches, saving, error) |
| Storage | list; watched-only; empty; selection; delete confirm; deleting; result |
| Reconnect media | default; only locations; unavailable; busy; success; error |
| Custom collections | list; empty; create; rename; detail; empty collection; delete confirm; error |
| Episode calendar | loading; populated; empty; partial error |
| Title detail | loading series; loading movie; local error; offline remote; loaded; synopsis expanded; overflow menu; maturity blocked; unreleased; action error; selection 0/N; season menu; season actions; episode sort; episodes loading/error; more-like loading/empty/error; collection loading/empty; cast skeleton; person browser; hide/delete confirm; trailer error |
| Native player | opening; resume prompt; controls visible/hidden; locked; unlock hint; buffering; scrub preview; release to cancel; double-tap seek; hold 2×; brightness; volume; fit toast; skip segment; playback error; unsupported; ended; credits countdown; speed panel; audio/subtitles panel; settings drawer; episodes drawer; quality drawer; subtitle search; transient message; casting; pinch zoom |
| Online player | webview loading; loaded provider; error card; inactive |
| External player | opening; no video; family blocked; playback; add-to-library dialog; result |

### Mobile state gaps that matter for parity

1. No account/profile screen (local-first app) — onboarding cannot copy Netflix's profile step literally.
2. No global toast; feedback is a Notice card or dialog.
3. No tablet layout; only responsive columns.
4. No light-theme screenshots in the current QA set.
5. Onboarding has no step dots, no full-bleed art, and no bottom-anchored CTA today.

---

## 3. Cross-cutting states

Capture these on every screen, not once:

- **Theme**: dark (parity), light (regression), system.
- **Viewport**: 1440 × 960 web, 1280 × 800 web, 390 × 844 web, 1080 × 2400 mobile portrait, 2400 × 1080 mobile player landscape.
- **Data**: populated, empty, loading, error, offline.
- **Focus and keyboard**: visible focus ring, skip link, Escape closes overlays.
- **Reduced motion**: entrance, carousel, drawer, player chrome.
- **Long content**: long title, long overview, missing artwork, very large library.
- **Text scaling**: Android font scale 1.3 and 2.0.
- **Orientation**: mobile player landscape only; app shell portrait.

## 4. Current baseline

The current app was captured at 1440 × 960 on 19 November 2026 into
`shots/ui-loop/baseline/`:

| File | Screen |
| --- | --- |
| `home.png` (in `shots/ui-loop/home/iter-1.png`) | Home, Lupin hero |
| `library-tv.png` | TV library with 3 shows |
| `library-movies.png` | Empty movies library |
| `search.png` | Search landing |
| `settings.png` | Settings overview |
| `title-mindhunter.png` | Mindhunter detail |

These are **current-state** evidence, not design targets. The targets are in
`docs/design/reference/`.
