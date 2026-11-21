# Working in Plexy

Start with the [local setup](README.md#develop-locally). Use Bun from the root of the repository. For manual web/server checks, point both `PLEXY_DATA_DIR` and `PLEXY_LOG_DIR` at an ignored directory within the current worktree.

## Where to start

| Change | Entry points |
| --- | --- |
| Browser playback, subtitles, or scrubbing | [Web watch route](apps/web/src/routes/watch) and [player components](apps/web/src/components/videojs). For stream selection and preparation, see [media routes](apps/server/src/routes-media.ts), [playback classification](apps/server/src/playback.ts), and [preparation](docs/PLAYBACK_PREPARATION.md). |
| API or authentication | [Server route assembly](apps/server/src/app.ts), the corresponding `apps/server/src/routes-*.ts` module, and [shared HTTP contracts and transport](packages/api-client/src). See the [API reference](docs/API.md). |
| Electron and native playback | [Electron main](apps/desktop/src/main), [preload](apps/desktop/src/preload), [IPC contracts](packages/desktop-bridge/src), and the [renderer bridge](apps/web/src/electron.d.ts). |
| Android screens, playback, or local catalog | [Expo routes](apps/mobile/src/app) enter [feature screens](apps/mobile/src/features). Local state and persistence adapters live in [mobile core](apps/mobile/src/core/library) and [local-library](packages/local-library/src). |

The [architecture guide](docs/ARCHITECTURE.md) explains how these pieces connect. Apps consume shared packages. Put cross-app HTTP and IPC types in the owning package and keep app-to-app imports out of the dependency graph. Change the route files to regenerate `apps/web/src/routeTree.gen.ts`. For Android native changes, edit Expo config, config plugins, or [the local module](apps/mobile/modules/plexy-media) so the changes survive regeneration of `apps/mobile/android/`.

## Imports

Use `@/` for imports into the current app's `src/` tree that would otherwise start with `../`. Keep `./` imports for nearby modules. Use `@plexy/<package>` exports for shared workspace packages and `@scripts/` for repository tooling imports. The root tooling TypeScript config maps `@/` to mobile source for release scripts. Leave generated imports to their generators and use filesystem paths where a tool expects a file path.

## What to run

- For one workspace, use `bun run turbo run typecheck --filter=@plexy/<name>` plus its relevant suite. For a single backend test file, use the isolated harness described in [Testing](docs/TESTING.md#focused-checks).
- For scan, setup, or playback API work, run `bun run smoke:playback` as well as the focused server tests.
- Run `bun run check` for cross-workspace changes or to reproduce pull-request CI. Use `bun run build:check:mobile` when changing Metro inputs or native dependencies.
- For native behavior, use an actual development client or the [Android emulator smoke workflow](docs/TESTING.md#android-e2e). See the [release guide](README.md#release) for packaging, which can reserve a version in GitHub.
