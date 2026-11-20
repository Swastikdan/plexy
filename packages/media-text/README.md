# `@plexy/media-text`

Dependency-free language names and subtitle-label formatting shared by the web and mobile UIs. Extracted so `apps/web/src/lib/subtitle-label.ts` and the mobile language helpers don't carry duplicate tables.

## Usage

```ts
import { languageName, subtitleLabel } from "@plexy/media-text";
```

Both apps keep thin re-export shims so screens didn't need renames. Keep this package free of app imports and runtimes.
