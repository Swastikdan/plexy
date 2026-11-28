# Migrate Plexy Beta to GPUI Kit

1. In [Cargo.toml](../Cargo.toml), replace the direct GPUI dependency with a pinned GPUI Kit release that builds on Apple Silicon. Update imports and the lockfile. Check the [published API](https://docs.rs/gpui-kit/latest/gpui_kit/) for the exact signatures.
2. In [main.rs](../src/main.rs), initialize the Kit and open the window with its root. Keep Plexy's fonts, icons, native menu actions, and AppKit handle for libmpv. Verify local playback, resize, and fullscreen before migrating controls.
3. Start in [Settings](../src/settings_ui.rs). Use Kit Button, Switch, Select, and Input. Keep preferences in the existing SQLite catalog and map [Plexy theme tokens](../src/theme.rs) to the Kit theme.
4. Move shared dialogs, menus, tabs, and inputs to Kit components as their callers migrate. Use the Kit's alert dialog for reset. Keep custom seek, preview, and video drawing on the GPUI primitives re-exported by the Kit.
5. Run the [locked tests, native self-tests, and macOS package build](../README.md#verify). Add Kit UI tests for Tab, Escape, focus restoration, and preference changes across relaunch.

Use the [GPUI Kit skill](../../../.agents/skills/gpui-kit/SKILL.md), its [coding guide](../../../.agents/skills/gpui-kit/references/coding-guides.md), and the [component docs](https://gpui-kit.com/llms.txt).
