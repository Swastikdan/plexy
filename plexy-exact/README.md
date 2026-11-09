# Plexy Exact port foundation

This directory starts the independent, serverless Exact port. It is **not yet a usable media app**. Existing apps are preserved. The Phase 0 gate in [the specification](../docs/exact-port-spec.md) is blocked; see [observations and remaining work](docs/spikes.md).

Implemented here: commit-pinned runtime setup, native-target manifest, a verification-status Contract screen, SQLite catalog schema, pure conversion planning/arguments/verification and a deletion-safe commit sequence through injectable storage adapters. These core functions have not been wired into a runtime or native module.

Run the host-independent checks from the repo root:

```sh
bun test plexy-exact/tests
```

With Bun **1.4.2**, generate the local launcher and install the exact locked runtime dependencies:

```sh
cd plexy-exact
bun tools/setup.ts
bun exact.mjs setup
bun exact.mjs contract build app.contract --json --errors-only
bun exact.mjs verify
bun exact.mjs verify android
```

Setup checks out the revision in `runtime.lock.json` under `../.build/exact-runtime`; generated launchers, compiler output and dependencies stay out of git. It refuses a mismatched or modified runtime. There is no server in this app. No original media is deleted by the current placeholder screen.

GitHub core checks run through `../.github/workflows/exact.yml`; legacy release builds remain intact. Native packaging and GitHub update installation must be added after device acceptance.
