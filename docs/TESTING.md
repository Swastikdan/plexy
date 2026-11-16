# Testing

The suite is deliberately split into four layers. Each one answers a different
question, and a change only merges when the cheap layers pass.

| Layer | Question it answers | Cost |
| --- | --- | --- |
| Unit and contract tests | Does the extracted logic still behave? | ~25s |
| Typecheck of tests | Does a test still match the API it calls? | ~10s |
| Metro bundle | Do the routes, assets and native config still compile? | ~60s |
| Android E2E | Does the app boot and navigate on a device? | ~20min |

## Commands

```sh
bun run test:native            # mobile + local-library unit tests
bun run test:native:coverage   # same run, with the coverage floor enforced
bun run typecheck:native       # app sources
bun run typecheck:tests        # mobile tests (separate tsconfig)
bun run bundle:native          # Metro export, catches broken routes/assets
bun run e2e:android            # Maestro flows, needs a device or emulator
bun run e2e:android:smoke      # only the smoke-tagged flows
```

`bun run build:check` runs the unit, typecheck and bundle layers locally
without needing Gradle or Xcode.

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
- Tag cheap, high-value flows `smoke`; the pull request job runs only those.
- Never assert on a spinner or an animated value. Assert on the settled state.

### CI

`.github/workflows/android-e2e.yml` builds the APK and runs the smoke flows on
an emulator. It is `continue-on-error: true` while the flows settle: a failure
shows on the pull request without blocking it. Remove that line once it has
been green for a week so a real regression blocks the merge.

## Adding tests

Put a test next to the layer it covers, in `apps/mobile/tests/<subject>.test.ts`
when it is pure logic. Keep pure decision logic out of screens so it stays
testable without a renderer — `features/*/lib/` exists for that reason, and
`architecture.test.ts` enforces the direction of the imports.

Prefer a test that fails when the behaviour breaks over a test that restates the
implementation. If a test only pins a literal that never changes independently,
it is probably not worth keeping.
