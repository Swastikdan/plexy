# Testing

## Pull-request checks

Run `bun run check` from the root. The [contributor workflow](../.github/workflows/check.yml)
runs the same command with Bun from `package.json` and FFmpeg on `PATH`.
It checks workspace boundaries, typechecks every app and shared package plus
scripts and mobile tests, runs strict mobile lint and the workspace and release
script tests, and exercises the playback smoke flow. The web typecheck builds
the web assets because the build generates the TanStack route tree.

### Focused checks

| Command | Scope |
| --- | --- |
| `bun run test:server` | Backend suites, each with a fresh database and log directory |
| `bun scripts/test-server.ts routes.test.ts` | One backend suite with the same isolation |
| `bun run test:desktop` | Electron proxy, relay, and other desktop logic |
| `bun run test:native` | Android logic and local-library suites |
| `bun run test:native:coverage` | Android and local-library suites with the coverage floor |
| `bun run typecheck:tests` | Android test types |
| `bun run bundle:native` | Android Metro export for route, asset, and native config checks |

### Playback smoke

`bun run smoke:playback` needs FFmpeg with libx264 on `PATH`. It generates a
short MP4, starts a fresh loopback server with its own database and logs, creates
an owner, and registers and scans the fixture folder through the public API.
It uses the session cookie to verify the playback manifest and compare a
byte-range response with the original file. It cleans up the server and its
temporary directory on exit. This check does not require an existing Plexy
instance, a browser, credentials for TMDB, or personal media.

### Build checks

`bun run build:check:mobile` runs the mobile typechecks, strict lint, tests, and
Metro export. `bun run build:check` runs the full contributor check and adds
the Electron main/preload build, Android Metro export, and server bundle assembly.
Neither command builds a signed installer or needs a device or emulator.

## Why the tests are typechecked separately

`apps/mobile/tsconfig.json` excludes `tests/` so the app build does not carry
`bun:test` types. That also means the tests were never typechecked, and a
signature change could break them silently: Bun strips types, so the failure
only appeared when the affected path happened to run. `typecheck:tests` closes
that gap using `apps/mobile/tests/tsconfig.json`.

## Coverage floor

`bun scripts/test-native.ts` runs the suite, writes
`.build/coverage/native/lcov.info` and fails when totals drop below the floor
in that script. Bun 1.4 accepts `--coverage-threshold` but does not enforce it,
so the check is done from the lcov report.

The floor is set just below the current numbers on purpose. **Raise it when
coverage improves. Do not lower it to make a branch green** — if a change
genuinely cannot be tested, say so in the pull request instead.

Coverage only measures what the unit suite imports. Screens are not imported by
any test, so their absence does not lower the number; that is what the E2E
layer is for.

## Android E2E

Flows live in `apps/mobile/.maestro/` and target a release APK, so the JS
bundle is embedded and no Metro server is needed.

### Choosing a selector

Prefer `id` (the `testID` prop) for anything that is tapped, and text for
assertions. Text is easier to read, ids survive copy changes.

```yaml
- tapOn:
    id: "tab-settings"
- assertVisible: "Settings"
```

Naming: `tab-<name>` for tab bar entries, `<area>-<thing>` for controls,
kebab-case throughout. `testID` is only needed on elements a flow actually
touches; there is no value in tagging every view.

### Writing a flow

- One flow per user-visible behaviour, not per screen.
- Start from `launchApp: { clearState: true }` so the run is deterministic. A
  fresh install has no library and Home redirects to folder setup, which makes
  that first screen a stable entry point.
- Tag cheap, high-value flows `smoke` so the manual workflow picks them up.
- Never assert on a spinner or an animated value. Assert on the settled state.

### CI

The [Android E2E workflow](../.github/workflows/android-e2e.yml) is run manually.
It builds an APK and runs the smoke flows on an emulator. To run them locally
against an installed APK, use `bun run e2e:android:smoke`. Use
`bun run e2e:android` to run the full Maestro suite.

## Adding tests

Put a test next to the layer it covers, in `apps/mobile/tests/<subject>.test.ts`
when it is pure logic. Keep pure decision logic out of screens so it stays
testable without a renderer — `features/*/lib/` exists for that reason, and
`architecture.test.ts` enforces the direction of the imports.

Prefer a test that fails when the behaviour breaks over a test that restates the
implementation. If a test only pins a literal that never changes independently,
it is probably not worth keeping.
