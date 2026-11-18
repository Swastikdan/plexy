# Plexy Turborepo migration and code reduction

The workspace tasks, shared server compile, and macOS CI composite action
are implemented. Release selection still uses `scripts/build-targets.ts`
to cover the embedded app dependencies and root packaging inputs. The
application code reductions in section 4 can land independently.

Plexy already has a Bun monorepo with four apps and three shared packages.
Add Turborepo as the task runner and keep Bun 1.4.4, one `bun.lock`,
the Expo dependency patches, and the existing `apps/*` and `packages/*`
workspaces. Install a pinned Turbo version in the root package and use it
from package scripts and CI. [Turborepo setup for an existing repository](https://turborepo.dev/docs/getting-started/add-to-existing-repository)

## Baseline

The starting commit (`5f0f6ff`) has 64,564 authored lines and 6,276 test lines
across tracked source, scripts, configuration, and workflows in `apps/`,
`packages/`, `scripts/`, and `.github/`. These are physical lines, including
comments and blanks. The count excludes 4,413 lines of vendored native headers,
7,328 lines of generated mobile license notices, and ignored build outputs. Root
configuration is outside this baseline. Include handwritten root configuration
alongside the same directories when measuring migration diffs.

| Area | Authored lines | Test lines |
| --- | ---: | ---: |
| Mobile | 22,347 | 2,465 |
| Web | 20,163 | 0 |
| Server | 13,279 | 3,166 |
| Desktop | 4,309 | 537 |
| Shared packages | 1,680 | 65 |
| Scripts and workflows | 2,786 | 43 |

The initial cleanup deletes the unused Vite configuration and shares FFmpeg
discovery between the desktop and server packagers. That saves **70 net lines**,
including the test change that checks release selection for the shared resolver.

## 1. Move development and checks onto Turbo

- Add `turbo.json`, ignore `.turbo/`, and refresh the lockfile with Bun. Keep
  package scripts as the concrete commands. Let the root scripts select tasks
  and preserve commands used by the README, CI, and release tooling.
- Make web and server `dev` persistent and uncached. Preserve Vite's
  `--host` behavior and the API proxy's `PLEXY_PORT`. Keep desktop and Expo
  opt-in. Remove `concurrently` after verifying the root dev command and its
  shutdown behavior.
- Add a workspace `test` script wherever a suite exists. Use the isolated
  [server test runner](../scripts/test-server.ts) as the server entry point
  so every suite still gets its own temporary data directory. Preserve mobile
  test type checking, strict lint, and the combined mobile and local-library
  coverage floors of 80% functions and 85% lines. Where CI already runs the
  coverage command, remove the duplicate plain test run after confirming it
  executes the same suites.
- Register root script type checking as a separate root task. Keep
  `@plexy/api-client` and `@plexy/local-library` as source packages. Configure
  upstream task hashes so a shared-source or tsconfig change invalidates its
  consumers, even for packages without a build command. [Task dependencies and transit nodes](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)

## 2. Model the build inputs before changing packaging

| Task | Inputs and dependencies | Output and caching |
| --- | --- | --- |
| Web build | Vite config, routes, public assets, shared API source, and build-time environment | Keep `dist/web/**` and the ignored `apps/web/src/routeTree.gen.ts` as task outputs. Order web type checking after route generation so a clean checkout and a cache hit both work. |
| Server staging | Web build for local runs, verified web artifact for release jobs, server source, migrations, and FFmpeg | Keep `dist/server` and build the server executable on the target host. Start uncached. |
| Desktop build and packaging | Web artifact, Bun server executable and migrations, Electron main and preload, Xcode, mpv/libmpv, and packaging assets | Keep `dist/mac`. Make `build:main` an explicit prerequisite and remove its duplicate invocation in the package script. Treat the current `build:main` as host-specific because it compiles the macOS addon. |
| Android bundle and APK | Expo/Metro, shared source, root native scripts and assets, generated license notices, and Expo environment | Keep the existing Gradle/EAS commands and APK path under `.build/native`. Start with export and APK tasks uncached. |

Use explicit task edges for cross-app build requirements. The package
manifests alone cannot express that both server and desktop ship the web UI
or that desktop embeds the server. Use root-relative Turbo globs for shared
scripts, assets, and outputs that live outside an app. Audit compile-time
environment variables, including Vite and Expo inputs, before enabling cache
reads. Keep remote caching off for the first migration. [Turbo configuration](https://turborepo.dev/docs/reference/configuration) · [Environment variables](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables)

Once the graph is verified, replace the 59-line
`scripts/build-check.ts` runner with Turbo tasks for checks and
preflight builds. Keep the native release commands separate from that check.
Then share the Bun server compile and migration staging between server and
desktop. Reuse that output when both artifacts are built on the same host.
Desktop's custom FFmpeg option and native playback resources still belong to
desktop packaging.

## 3. Simplify CI after the task graph matches release behavior

- Keep the verified web artifact handoff from the checks job to the macOS and
  Linux packaging jobs. Local packaging can depend on the Turbo web build.
  CI packaging should consume the downloaded artifact explicitly so a cache
  miss on a different runner cannot silently rebuild the shipped UI.
- Compare Turbo's affected selection with
  [the existing selector](../scripts/build-targets.ts). Cover web or server
  changes selecting both embedded consumers, desktop-only and mobile-only
  changes, the API client affecting all three artifacts, root packaging
  inputs, docs-only changes, manual targets, and a missing Git base. Include
  desktop's `bundle-mpv`, `bundle-libmpv`, and `after-pack-mpv` scripts in
  the comparison. Set the comparison base and head explicitly in CI. Replace
  the path table only once the release-task selection passes this matrix.
  [Affected filtering and dry runs](https://turborepo.dev/docs/reference/run)
- Share the macOS packaging, validation, artifact upload, and late GitHub
  release steps between the primary and fallback jobs. The two job blocks
  currently share 119 matching lines. Extract shared steps into a local
  composite action and keep the runner, job failure handling, fallback
  scheduling, and actor gates in the workflow.
  Preserve platform checks, signature verification, artifact naming,
  checksums, and updater metadata.

## 4. Reduce application code in focused changes

- **Subtitle labels.** Web and mobile both strip the same technical tokens
  and carry overlapping language tables. Share the pure normalization and
  language data. Preserve each client's aliases, fallbacks, and label
  presentation, including mobile's separate language and default badge.
  Keep WebVTT parsing and platform subtitles in their current clients.
  [Web formatter](../apps/web/src/lib/subtitle-label.ts) · [Mobile formatter](../apps/mobile/src/features/player/lib/subtitles.ts) · [Mobile language data](../apps/mobile/src/shared/lib/media-language.ts)
- **Mobile title actions.** Share the identical hide-title confirmation and
  shared action labels across local and online cards. Keep permanent file
  deletion local and remote library writes in the remote adapter.
  [Local actions](../apps/mobile/src/features/catalog/hooks/use-title-actions.ts) · [Online actions](../apps/mobile/src/features/remote/hooks/use-remote-title-actions.ts)
- **Web and desktop playback.** The browser player and the in-window desktop
  player both find active intro, recap, and outro markers and calculate when
  progress counts as played. Share the pure rules in web code with both callers,
  preserving their existing enablement checks, report timing, and transport.
  [Browser watch route](../apps/web/src/routes/watch/%24fileId.tsx) · [Desktop watch component](../apps/web/src/components/native/native-watch.tsx)

Count additions as well as deletions, including new task configuration and
workflow files. Record net lines by change. Prioritize deleting the orchestration
runner, redundant compilation, and duplicated CI steps before larger
application refactors. Mobile's title and playback screens are large, but file
splitting alone yields no reduction. Share behavior where the current copies
can be shown to agree.

## Acceptance checks

1. From a clean checkout, run `bun install --frozen-lockfile` and inspect
   `bunx turbo run … --dry=json` for the expected task edges and inputs.
2. Run the web build and type check without an existing route tree. Move the
   generated outputs aside and rerun to verify Turbo restores both the route
   tree and the embedded web artifact. Change an API contract and verify
   the relevant caches invalidate.
3. Run the existing checks, including the independent server suites, desktop
   tests, mobile tests, coverage, and Android export. Verify that root dev
   still starts the browser UI and API and shuts both down on exit.
4. Build the Linux and Apple Silicon server archives, Apple Silicon DMG/ZIP,
   and Android APK on their supported runners. Smoke-test binaries, the
   embedded UI, macOS signing and version metadata, and Android installation
   before retiring the existing CI path.
