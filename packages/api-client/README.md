# @plexy/api-client

Source-only workspace package containing Plexy's shared HTTP contract layer.

- `src/contracts/` — wire shapes shared by the server and every client.
- `src/types.ts` — public re-export of the contract modules.
- `src/caps.ts` — browser capability probing.
- `src/transport.ts` — one HTTP transport policy: URL building, retries, deadlines, credentials, and error normalization.

## Boundaries

- May depend on no other workspace package.
- Must not import server, web, desktop, or mobile application code.
- Is consumed as TypeScript source; there is no separate build step.

## Usage

```ts
import { probeBrowserCaps, type ItemCard } from "@plexy/api-client";
import type { PlaybackState } from "@plexy/api-client/types";
```

Run `bun run --filter @plexy/api-client typecheck` after changing exports.
