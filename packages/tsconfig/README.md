# @plexy/tsconfig

Shared TypeScript presets. Apps and packages extend a preset by package name, so compiler options stay consistent across the workspace.

| Preset | Use for |
| --- | --- |
| `@plexy/tsconfig/base.json` | Source-only packages that are consumed by a bundler or runtime |
| `@plexy/tsconfig/bun.json` | Bun runtimes, tests, and repository scripts |
| `@plexy/tsconfig/react.json` | Browser React apps |

`apps/mobile` extends `expo/tsconfig.base` because Expo owns the React Native compiler settings.
