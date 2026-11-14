# @plexy/local-library

Device-local catalog and metadata logic shared by the Plexy mobile app.

- `src/library.ts` — local root/index state, scanning, progress, identity, and skip markers.
- `src/metadata.ts` — metadata normalization for locally imported files.

## Boundaries

- Depends on `@plexy/api-client` for shared wire types only.
- Must not import `apps/mobile` code. Integration tests that exercise mobile adapters live in `apps/mobile/tests`.
- Device I/O is injected through `LocalIO` / `MetadataIO`, so the package stays testable in Bun without Android.

## Usage

```ts
import { LocalLibrary, type LocalIO } from "@plexy/local-library/library";
import { fetchMetadata } from "@plexy/local-library/metadata";
```

Run `bun run --filter @plexy/local-library test` and `bun run --filter @plexy/local-library typecheck`.
