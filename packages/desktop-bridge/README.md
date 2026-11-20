# `@plexy/desktop-bridge`

Single source of truth for the Electron IPC contract shared by the desktop main process, the preload bridge, and the web UI.

- `apps/desktop/src/main/*` and `updater` import these shapes instead of redeclaring them.
- `apps/desktop/src/types.ts` re-exports them.
- `apps/web/src/electron.d.ts` imports them for `window.electronAPI`.

Add new IPC shapes here first, then consume by package name. Never duplicate the contract in an app.
