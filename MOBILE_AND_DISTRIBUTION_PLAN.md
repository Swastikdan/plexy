# Mobile UI and App Distribution Plan

## Goal

Deliver a mobile client UI that connects to a separately running Plexy server, and make the project build three distinct deliverables:

1. **Desktop UI client** — desktop-format UI only; connects to a Plexy server.
2. **Backend binary** — the server executable by itself, with no desktop UI or Electron shell.
3. **Combined desktop app** — the existing Electron experience, with its UI and bundled server in one installable app.

The mobile client is a UI/client project only. Server-side behavior, media access, scanning, metadata, database, and transcoding remain on the server. Reuse existing APIs; only change server APIs if implementation proves a specific client requirement cannot be met.

## Proposed product shape

- Keep `apps/server` as the source of server behavior and its independently buildable executable.
- Keep `apps/desktop` as the Electron desktop shell and its current bundled-server mode.
- Evolve `apps/web` into the shared browser UI/client foundation, with responsive layouts for mobile and desktop where that is practical.
- Treat desktop UI-only and mobile as clients configured with a server URL and device pairing. Do not start a local backend from these clients.
- Keep the combined Electron application as the current default desktop distribution.

## Delivery sequence

1. **Confirm client boundaries:** document which screens are viewer UI versus server administration; verify connection, pairing, playback, and API flows.
2. **Separate UI modes:** make the desktop UI-only build connect to a configured server and avoid starting or packaging `plexy-server`; retain bundled-server startup in the combined app.
3. **Build mobile UI:** implement a touch-first responsive client for connection/pairing, library browsing, search, title details, playback, and watch progress using existing APIs.
4. **Formalize output targets:** provide named build/package commands and predictable artifacts for desktop UI-only, standalone backend binary, and combined Electron app.
5. **Validate releases:** verify each artifact has only its intended runtime responsibilities, then document setup and server compatibility.

## Key decisions to resolve during implementation

- Whether mobile ships first as an installable web/PWA client or as a native wrapper. Start with the responsive web client/PWA unless a required mobile capability demands a wrapper.
- How client builds receive a default server URL (build-time default, first-run entry, or both). Always allow the user to change it.
- Whether desktop UI-only is distributed as a web app/PWA or as a desktop shell with no local backend. Preserve a desktop-format UI and do not bundle server behavior in this target.
- Which server version/API compatibility range clients support, especially for pairing and playback.

## Acceptance criteria

- A mobile device can connect to a user-supplied Plexy server, pair using the existing flow, browse and play supported media, and persist watch progress without a local backend.
- A desktop UI-only deliverable launches its UI and connects to a remote/local server without launching a server process.
- The standalone backend binary runs headlessly and serves the existing API (and any server-owned web assets required by current behavior) without Electron.
- The combined app retains its current integrated launch experience and continues to bundle the backend binary.
- Build documentation identifies all three targets, their commands, artifacts, configuration, and responsibilities.

## Out of scope

Reimplementing server features in mobile/desktop clients; changing media storage or processing ownership; adding server features unrelated to a demonstrated client gap; and requiring native mobile functionality before validating the responsive client approach.

See [the detailed implementation plan](docs/MOBILE_AND_DISTRIBUTION_DETAILED_PLAN.md) for workstreams, sequencing, architecture, and validation.
