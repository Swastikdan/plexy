# Untangle decision log

Working record for the repository-wide untangle pass. Problems first, then the
fix that removes each group.

## Problems

### Server

- `apps/server/src/scan.ts:510` and `apps/server/src/routes-media.ts:64` both hand-write the same probe→`UPDATE media_files` column mapping. Adding a probe column means editing both, and nothing links them.
- `apps/server/src/routes-media.ts:46` `getFile()` silently falls back from a file id to an item id, while every stream route re-implements that fallback (`:657`), then asserts `getFile(fileId)!` (`:669`, `:688`, `:739`, `:778`, `:816`). The resolved row and the requested id can disagree without anything showing it.
- `apps/server/src/routes-media.ts:693`, `:781` duplicate the `supportedMaxHeights` list and its error message.
- `apps/server/src/routes-media.ts:690`, `:740`, `:790`, `:821` repeat the "non-negative integer index, else 0" audio-index parsing four times.
- `apps/server/src/routes-media.ts:536` and `:635` repeat the same watch-state query + projection.
- `apps/server/src/routes-media.ts:516`, `:628` and `apps/server/src/routes-catalog.ts:150` each map a media row into `classifyPlayability` inputs.
- `apps/server/src/routes-catalog.ts:71`, `:383`, `:416` call `requestUser` up to four times per request; the same identity is re-derived instead of passed.
- `apps/server/src/routes-catalog.ts:562`, `:591`, `:627` repeat item-id validation and produce the same 400 in three forms; `:600`/`:608` keep two copies of the watch-state upsert.
- `apps/server/src/access.ts:199` and `apps/server/src/routes-catalog.ts:72` special-case `NODE_ENV === "test"` to mean "no signed-in user means everything is visible". The same meaning already follows from `authGuard`: a missing user only happens when authentication is disabled, which is an open server.
- `apps/server/src/essentials.ts:62`, `apps/server/src/routes-admin.ts:373`, `apps/server/src/auth.ts:406` each carry their own test-only authentication bypass, so "the test harness has no token" is encoded three different ways.
- `apps/server/src/config.ts:96` hand-copies every config field into `redactedView`; a new setting is silently missing from the API until someone remembers this function.
- `apps/server/src/config.ts:68` and `:112` rebuild the env-token expression twice.
- `apps/server/src/access.ts:118` keeps a regex allow-list of viewer paths next to the route definitions it mirrors; adding a route silently makes it admin-only.
- `apps/server/src/main.ts` startup maintenance duplicates `routes-catalog.ts upgradeArtworkUrl`'s intent and re-imports `./db` / `./scan` dynamically.

### Web

- `apps/web/src/routes/title/$itemId.tsx:846` contains a literal `return (` inside JSX, so broken markup renders on the page.
- `apps/web/src/routes/title/$itemId.tsx:238` invents IMDb and Rotten Tomatoes scores from the TMDB rating; only the TMDB score is real data.
- `apps/web/src/routes/title/$itemId.tsx:206`, `:211` keep watchlist/favorite flags only in `localStorage` with no server or account link, so they do not survive devices and silently diverge between accounts.
- `apps/web/src/routes/watch/$fileId.tsx:1120`, `:1162` hard-code `/api/subtitles/...` instead of using `api.subtitlesUrl()`, breaking hosted/cross-origin builds.
- `apps/web/src/routes/watch/$fileId.tsx:229` re-implements `queries.play` and hides a `setKnownDuration` side effect inside `queryFn`.
- `apps/web/src/client.ts:84` and `:118` duplicate retry policy, health reporting and error formatting.
- `apps/web/src/client.ts:279` `markWatched` is a copy of `setWatched(id, true)`.
- `apps/web/src/client.ts` re-declares response shapes that already live in `@plexy/api-client`.
- `apps/web/src/routes/admin/index.tsx:54` `ADMIN_TABS` and `:75` `tabs` are two lists of the same tabs.
- `apps/web/src/routes/admin/index.tsx:558` links with a hard-coded `/title/${id}` href instead of the typed router.
- `apps/web/src/routes/admin/index.tsx:1499` re-parses release tags inline for build numbers.

### Tests

- Tests coupled to implementation internals rather than observable behaviour.
- Tests that cannot fail (no meaningful assertion / tautologies).
- Comment lines that only restate the code.

## Fixes

### One persisted probe result

Add `media-facts.ts` with `storeProbeFacts(fileId, facts)`; both the scanner and
just-in-time playback call it. Adding a probe column is one edit.

- `apps/server/src/scan.ts` probe→UPDATE block
- `apps/server/src/routes-media.ts` `ensureFileProbed` probe→UPDATE block

### One file resolution that reports what it resolved

Replace the id/item-id guessing plus `getFile(id)!` with `openableFile(id)`,
which returns the resolved row (or null after marking it unavailable). Every
stream/download/remux/transcode/HLS route uses the row it was given.

- `apps/server/src/routes-media.ts` stream, download, remux, transcode, HLS paths

### One definition per media rule

- `MAX_HEIGHT_OPTIONS` + `parseMaxHeight()` + one error response.
- `audioIndex(value)` for the four copies.
- `watchStateFor()` for the play manifest and legacy playability view.
- `rowPlayabilityFacts()` next to `classifyPlayability`, used by both route
  modules.
- `parseItemId()` + `invalidItemId()` and a single watch upsert statement.

### One identity per request

Look up `requestUser` once at the top of each handler and pass `user` to
`attachArt`. Remove the `NODE_ENV` escape hatches: `authGuard` already defines
"no user == authentication disabled", and the test harness reaches that same
path through `buildApp({ requireAuth: false })`.

### One admin bypass

`denyIfNotLocal`, `accessGuard`, `authGuard` and the per-route admin check all
derive "owner request" from `isDirectLoopbackContext` plus the signed-in role.
The test-owned bypass moves next to the guard that needs it (a single helper),
not into each call site.

### Settings projection cannot drift

Destructure `tmdbToken` out of the config and spread the rest, so new settings
appear automatically. Extract `envTmdbToken()` for the two reads.

### One retry pipeline on the client

`requestJson()` owns deadlines, retryable statuses, health reporting, 401
handling and error conversion; both Eden and REST calls run through it.
`markWatched` delegates to `setWatched`. Shared response types move to
`@plexy/api-client`.

### Typed router and one tab list

`ADMIN_TABS` becomes the single `{ key, label }` list; the review link uses
`<Link to="/title/$itemId">`.

### Real data only

Remove the literal `return (` and the fabricated IMDb/RT badges; keep the TMDB
score that comes from the server.

### Media URLs go through the API client

The player uses `api.subtitlesUrl()` and `queries.play`, with duration synced
through an effect rather than a query side effect.

### Tests assert behaviour, not wiring

- `routes.test.ts`: replaced the property-presence home/items/search smoke
  checks with assertions that the limit actually limits, a matched title is
  found, and episodes stay out of the title results.
- `hydrate.test.ts`: stubs `fetch` and serves TMDB-shaped responses instead of
  writing rows into `tmdb_cache` with hand-computed SHA-1 keys, so a change to
  caching or URL construction no longer breaks the test.
- `parse.test.ts`: dropped the extension-set mirror; the scanner's real path
  handling is covered by `parsePath` cases.
- `config.test.ts`: dropped the version self-comparison; redaction and
  persistence remain covered.

### Comments state intent, not mechanics

Removed comments that repeated the statement below them (Electron IPC checks,
effect dependencies, `requestSingleInstanceLock`, server polling waits,
route/constant restatements). Kept comments that explain why a constraint
exists, such as prepared-file locality, retry policy, and security boundaries.
