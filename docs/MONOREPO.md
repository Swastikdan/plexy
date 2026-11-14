# Monorepo layout and ownership

Plexy is a Bun workspace monorepo. The root orchestrates installs, builds, and releases; application code lives in `apps/*`; reusable code lives in `packages/*`.

```text
apps/
  web/        Browser frontend embedded into desktop and server builds
  server/     Bun backend and HTTP API
  desktop/    Electron shell and desktop updater
  mobile/     Expo Router Android app
packages/
  api-client/     HTTP wire contracts, browser capability probing, transport policy
  local-library/  Device-local catalog, scanning, metadata, and skip-marker logic
  tsconfig/       Shared TypeScript presets
```

## Dependency direction

```text
apps/*  ->  packages/*
packages/*  ->  packages/*
```

The arrow points one way. Concretely:

- A package must never import from `apps/*`. Integration tests that exercise app adapters belong in the app's test directory.
- `@plexy/api-client` depends on no workspace package. It must not import server, web, desktop, or mobile code.
- `@plexy/local-library` depends on `@plexy/api-client` for wire types only.
- Apps own the third-party packages they import. Runtime dependencies do not live in the root `package.json`.
- The root `package.json` contains workspace tooling only: Bun, TypeScript, the build/release scripts, and the React type pins that keep a single React type graph across web and mobile.

## Workspace commands

| Command | Purpose |
| --- | --- |
| `bun install` | Link all workspaces and install the dependency graph |
| `bun run --filter @plexy/<name> <script>` | Run one workspace package's script |
| `bun run typecheck` | Typecheck server, web, desktop, shared packages, and root scripts |
| `bun run typecheck:native` | Typecheck the Expo app |
| `bun run test:packages` | Run shared-package tests |
| `bun run test:native` | Run mobile and local-library tests |
| `bun run build:web` | Build the shared browser frontend |
| `bun run build` | Build desktop, server, and mobile deliverables |

The build system stays on Bun workspaces and the scripts in `scripts/`; CI calls those same commands. There is no Turborepo/Nx layer to keep in sync.

## Shared packages are source-only

`@plexy/api-client` and `@plexy/local-library` export TypeScript source directly through `package.json` `exports`. There is no separate package build step. This keeps the dev loop fast and avoids stale `dist/` output, at the cost of requiring consumers to run a TypeScript-aware bundler or runtime (Vite, Bun, Metro).

When adding a new subpath:

1. Add the file under `src/`.
2. Add an explicit `exports` entry in the package's `package.json`.
3. Add a `typecheck` script if the package does not have one.
4. Import it by package name (`@plexy/api-client/types`), never by a relative path into another workspace.

## Shared TypeScript config

`@plexy/tsconfig` provides:

- `base.json` for source-only packages
- `bun.json` for Bun runtimes, tests, and repository scripts
- `react.json` for browser React apps

Apps and packages extend the package by name. `apps/mobile` extends `expo/tsconfig.base` because Expo owns the React Native compiler settings.

## Adding an app or package

1. Create the directory under `apps/` or `packages/`; the root `workspaces` globs pick it up automatically.
2. Give it a `package.json` with a `@plexy/*` name, `private: true`, and scripts for `typecheck` and tests where relevant.
3. Extend the appropriate `@plexy/tsconfig` preset and add `@plexy/tsconfig` to its dev dependencies.
4. Declare every third-party import in that package's own dependencies.
5. Add the package to the root `typecheck` script if it is not already checked transitively.
6. Add it to the CI verification step if it has its own test or type surface.

## Dependency hygiene

- No root runtime dependencies. The root may hold tooling and hoisting pins, but not app libraries.
- No phantom dependencies: if code imports it, the nearest `package.json` declares it.
- No reverse imports from `packages/*` into `apps/*`.
- Keep the dependency graph acyclic. `apps/mobile/tests/architecture.test.ts` already checks the mobile graph.
- React type versions are pinned at the root so `@types/react` is not duplicated between the web and mobile dependency trees. Runtime React versions stay owned by each app.
