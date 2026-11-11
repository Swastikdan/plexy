# Mobile structure

Expo Router loads `src/app/_layout.tsx` through `expo-router/entry`.

- `src/app`: route adapters and Stack/Tabs layouts only. Home, Libraries, Search,
  and Settings live in `(tabs)`; item details, player, and downloads use the root stack.
- `src/screens`: mobile screen implementations. Keep navigation callbacks explicit
  so screens are independent of the router. Catalog contains the existing catalog
  screens; player contains the native playback view.
- `src/components`: reusable mobile UI, including primitives in `ui.tsx`, thumbnails,
  update controls, library attention, and casting controls.
- `src/ui`: mobile presentation tokens and formatting helpers.
- `src/providers`: startup, fonts, local library restoration, and client lifecycle.
- `src/navigation`: the mapping from media actions to serializable route params.
- `src/lib`: device database and local-library runtime integration.

`packages/native-client/src` contains reusable API, context/state hooks, storage,
networking, download, progress, update, subtitle, and image-cache logic. It exports
no screens or visual components. Context platform slots accept app-owned settings,
thumbnail, focus, and cast implementations; they do not import those implementations.
`packages/api-client` owns API contracts; `packages/local-library` owns indexing and
metadata logic. TV owns its presentation under `apps/tv/src`.

Change shared behavior in those packages. Change mobile presentation here. Do not
import TV screens or add app UI to shared packages. The architecture tests enforce
these dependency boundaries. Downloads are resolved by ID from client state rather
than serialized into navigation params; next-episode playback replaces the player
route so Back returns to the title.

Verify with `bun run typecheck:native`, `bun run test:native`, and
`bun run --filter @plexy/mobile bundle`. Native playback, Android Back, folder setup,
and orientation still need device checks.
