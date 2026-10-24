# Plexy Cross-Platform Plan: Desktop (Electron) & Android Mobile (React Native)

This document outlines the architectural roadmap, feasibility assessment, technical requirements, and implementation plans for extending **Plexy** to:
1. **Desktop (Electron)**: Bundling both the Bun media server and the React web UI into a self-contained cross-platform desktop application.
2. **Mobile (Android with React Native)**: Analyzing the feasibility of bundling the server and UI on-device versus the industry-standard client-server model (Plex/Jellyfin), along with an actionable mobile roadmap.

---

## 1. Executive Feasibility & Complexity Matrix

| Target Platform & Architecture | Feasibility | Complexity | Est. Timeline | Code Reuse | Verdict & Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Electron Desktop** *(Bundled UI + Local Server)* | **High (9/10)** | **Low – Moderate** | 1 – 2 Weeks | **~95%** | **Strongly Recommended.** Use the **Sidecar Pattern**: Electron manages and spawns the compiled `dist/plexy` binary as a child process. |
| **Android Mobile** *(100% Local Server + UI on device)* | **Very Low (2/10)** | **Extremely High** | 2 – 4+ Months | **~10–20%** | **Not Recommended.** Bun does not run on Android; transcoding causes severe thermal/battery drain; Scoped Storage blocks arbitrary folder scanning. |
| **Android Mobile (React Native)** *(Plex/Jellyfin Client Model)* | **High (8/10)** | **Moderate** | 3 – 5 Weeks | **~40%** *(RPC & types)* | **Recommended Mobile Path.** Server runs on PC/NAS; React Native client connects over LAN/Wi-Fi with an offline "Download / Sync" feature. |
| **Android Mobile (Capacitor / PWA Wrapper)** | **High (8.5/10)** | **Low** | 3 – 5 Days | **~90%** *(DOM UI)* | **Fastest Mobile Prototype.** Wraps the existing React 19 web app inside an Android WebView connecting to the local desktop server. |

---

## 2. Desktop Conversion Plan (Electron)

### 2.1 Architecture: The Sidecar Pattern

Because Plexy’s server is built on **Bun** (`bun:sqlite`, `Bun.file`, `Bun.env`, and native `@mediabunny/server` / `node-av` bindings), attempting to run the server code directly inside Electron's Node.js runtime would require re-writing database layers and media modules.

Instead, Electron uses the **Sidecar Pattern**:
1. Electron's **Main Process (Node.js)** packages and spawns the compiled standalone Bun executable (`dist/plexy`).
2. The server binds locally to `http://127.0.0.1:8765`.
3. Electron's **Renderer Process (Chromium `BrowserWindow`)** displays the UI and communicates with the local server over HTTP/RPC.
4. On application quit, Electron cleanly stops the sidecar child process with `SIGTERM`.

```
┌─────────────────────────────────────────────────────────────┐
│                    Plexy Electron App                       │
│                                                             │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │  Main Process (Node)  │       │  Renderer (Chromium)  │  │
│  │  - App lifecycle      │       │  - React 19 Web SPA   │  │
│  │  - Window management  │       │  - Lucide / Base UI   │  │
│  │  - Native File Dialog │       │  - Video player       │  │
│  └──────────┬────────────┘       └───────────▲───────────┘  │
│             │ spawns & supervises            │              │
│             ▼                                │ HTTP / RPC   │
│  ┌───────────────────────────────────────────┴───────────┐  │
│  │           Sidecar Process (`dist/plexy`)              │  │
│  │  - Elysia API & Static Server (http://127.0.0.1:8765)  │  │
│  │  - SQLite database (WAL mode)                         │  │
│  │  - Mediabunny probe, remux & transcode workers         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Native Desktop Integrations

Electron introduces key desktop-grade improvements over standard browser tabs:
1. **Native Directory Picker**:
   - Web browsers cannot directly browse arbitrary local disks. In Electron, `dialog.showOpenDialog({ properties: ['openDirectory'] })` lets users pick movie/TV folders naturally.
2. **System Tray & Background Running**:
   - Plexy can minimize to the system tray so LAN streaming continues in the background even if the main window is closed.
3. **Hardware-Accelerated Video**:
   - Chromium in Electron supports GPU flags (`--enable-features=VaapiVideoDecoder`, `--ignore-gpu-blocklist`) for hardware-accelerated playback.
4. **Automatic Port Fallback**:
   - If port `8765` is busy, Electron can pass a random free port to the sidecar via `--port <port>` or environment variables.

### 2.3 Proposed Directory Structure
```
apps/
  desktop/
    package.json
    tsconfig.json
    electron-builder.yml
    src/
      main/
        index.ts          # Main process: spawns sidecar, creates BrowserWindow
        sidecar.ts       # Process manager: health checks, spawn, SIGTERM
        menu.ts          # Application menus
        tray.ts          # System tray icon & controls
        ipc.ts           # Native folder dialog handlers
      preload/
        index.ts          # Exposes safe desktop APIs (e.g. window.electron.pickDirectory())
```

### 2.4 Implementation Steps & Milestones

- [ ] **Phase 1: Project Setup**: Create `apps/desktop` within the pnpm/bun workspace. Install `electron` and `electron-builder`.
- [ ] **Phase 2: Sidecar Manager**: Implement `sidecar.ts` to locate `dist/plexy` inside Electron’s `process.resourcesPath`, spawn it, poll `http://127.0.0.1:8765/api/settings` until ready, and register cleanup hooks (`app.on('before-quit')`).
- [ ] **Phase 3: IPC Directory Dialog**: Wire up an IPC handler in Electron for `dialog.showOpenDialog` and connect it to the setup flow in `apps/web`.
- [ ] **Phase 4: Packaging**: Configure `electron-builder` to bundle macOS (`.dmg`), Windows (`.exe` NSIS installer), and Linux (`.AppImage` / `.deb`).

---

## 3. Android Mobile: Feasibility & Reality Check

### 3.1 The "100% Local Bundle (Server + UI on Android)" Reality

The user asked: *How complex is it to bundle both the UI and server locally on Android using React Native?*

**Verdict: Not viable without an almost total rewrite of the backend into native C++/Kotlin or Go.**

Here are the 4 fundamental roadblocks:

#### Roadblock 1: Bun Cannot Run on Android
- **The Issue**: Plexy's backend uses `bun:sqlite`, `Bun.file`, `Bun.serve`, and Bun's execution model.
- **Android Support**: Bun has **no Android NDK runtime** and does not compile into an Android APK. React Native runs on the **Hermes engine** (or JavaScriptCore), which does not support Node.js or Bun runtime APIs.
- **Result**: You cannot simply embed `dist/plexy` or `apps/server` inside an APK.

#### Roadblock 2: Video Transcoding & Thermal / Battery Throttling
- Mediabunny and native `node-av` probe and transcode heavy video streams (H.264, HEVC, 4K).
- Running background transcoding on mobile will drain a full battery in under an hour, cause thermal throttling, and cause the Android OS (Android Low Memory Killer / Doze Mode) to kill the background process immediately.

#### Roadblock 3: Android Scoped Storage Restrictions
- Desktop Plexy scans arbitrary POSIX paths like `/Volumes/Drive/Movies`.
- Android 11+ enforces **Scoped Storage**. Apps cannot freely traverse storage without the Storage Access Framework (SAF) or `MANAGE_EXTERNAL_STORAGE` permission (which is banned by Google Play for standard media player applications).

#### Roadblock 4: React DOM vs React Native UI Paradigm
- `apps/web` is built for HTML DOM: `<div>`, `<header>`, Tailwind CSS 4, `@base-ui/react`, `@tanstack/react-router`, HTML5 `<video>`, and `hls-video-element`.
- React Native does not support HTML DOM, CSS, or HTML5 video tags.
- It requires `<View>`, `<Text>`, Flexbox native styling, Expo Router / React Navigation, and native media players like `react-native-video` (ExoPlayer).
- **Result**: 0% of the UI template code can be reused directly; the entire mobile UI must be written in React Native primitives.

---

## 4. The Recommended Mobile Architecture (Plex / Jellyfin Model)

Every modern media platform (Plex, Jellyfin, Emby, Infuse) solves this with a **Client-Server Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Home Server / PC                         │
│  - Runs Plexy (Desktop / NAS / CLI)                         │
│  - Stores the media library & SQLite database               │
│  - Scrapes TMDB metadata & probes media                     │
│  - Remuxes / transcodes on demand                           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Wi-Fi / LAN / Tailscale
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Android Phone (React Native Client)           │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ UI: React Native (Expo) + Native Video (ExoPlayer)    │  │
│  │ Client: Shared `@plexy/api-client` (Eden Treaty)      │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Optional: "Download / Sync to Device" for Offline     │  │
│  │ - Mobile requests pre-transcoded MP4 from server      │  │
│  │ - Stores in app's private sandbox                     │  │
│  │ - Plays offline without running an HTTP server        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 How Code Reuse Works in this Model
1. **Shared API Client (`packages/api-client`)**:
   - Fully reusable! The typed RPC Eden client, data types, and playback classification logic run seamlessly in React Native.
2. **Native Video Playback**:
   - Uses `react-native-video` backed by Android's native **ExoPlayer**, which supports hardware decoding, background audio, subtitles, and hardware aspect ratios.
3. **Offline Playback (Download Feature)**:
   - Instead of running a broken server on mobile, the user taps "Download".
   - The server converts the video to a web-compatible MP4 and streams the file to the phone's sandboxed storage.
   - The phone plays the local file directly through ExoPlayer.

### 4.2 Proposed Mobile Directory Structure
```
apps/
  mobile/
    package.json
    app.json               # Expo config
    src/
      app/                 # Expo Router (file-based navigation)
        index.tsx          # Home screen (Hero, Continue Watching, Carousels)
        detail/[id].tsx    # Movie / Show details
        player/[id].tsx    # Fullscreen ExoPlayer video screen
        settings.tsx       # Server IP / URL connection & TMDB settings
      components/
        MediaCard.tsx
        Carousel.tsx
        DownloadManager.tsx
      lib/
        api.ts             # Imports @plexy/api-client
        storage.ts         # Local downloaded media database
```

---

## 5. Alternative Rapid Mobile Option: Capacitor / PWA

If the goal is to test Plexy on an Android phone **this week** without rewriting the entire UI into React Native:
- Install **Capacitor** into `apps/web`:
  ```sh
  pnpm add @capacitor/core @capacitor/android
  pnpm cap init Plexy com.plexy.app
  pnpm cap add android
  ```
- Build the web assets (`bun run build:web`).
- The app runs in an Android Chrome WebView and connects to the desktop server over Wi-Fi (`http://192.168.x.x:8765`).
- **Timeline**: 2 to 3 days.

---

## 6. Monorepo Roadmap & Target Architecture

```
Plexy/
├── apps/
│   ├── server/          # Existing Elysia + Bun backend
│   ├── web/             # Existing React 19 + Tailwind web SPA
│   ├── desktop/         # NEW: Electron wrapper (Sidecar pattern)
│   └── mobile/          # NEW: React Native / Expo Client (Plex model)
├── packages/
│   └── api-client/      # Shared Eden Treaty RPC client & TypeScript types
├── dist/                # Build artifacts (plexy binary, web SPA, installers)
└── PLAN.md              # This cross-platform reference specification
```

### Execution Priorities:
1. **Milestone 1 (Desktop Electron)**: Build `apps/desktop`, bundle `dist/plexy`, test on macOS and Windows.
2. **Milestone 2 (Mobile Client)**: Initialize `apps/mobile` with Expo, link `@plexy/api-client`, and implement Home + Player screens.
3. **Milestone 3 (Offline Sync)**: Add download manager endpoints on the server and client-side offline caching.
