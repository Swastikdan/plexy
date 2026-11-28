# Plexy Server for macOS

`Plexy Server.app` is the standalone menu bar app for the Plexy backend. It
runs the bundled server, serves the existing web UI, and stays out of the Dock.
The Plexy Mac client and Android connect to it as an external server.

## Build

From the repository root:

```sh
bun run build:server
bun run build:server:mac
```

The first command produces `dist/server` with the backend, FFmpeg, migrations,
and web UI. The second compiles `Sources/main.swift` with Swift and writes
`dist/server-mac/Plexy Server.app` and
`Plexy-Server-1.0.0-mac-arm64.dmg`.

## Run

Launch `Plexy Server.app`. The status item appears in the menu bar:

- **Open Library** opens the server web UI.
- **Open Server Setup** opens the first-run owner and library setup.
- **Copy Server Address** copies the loopback URL.
- **Start Server** / **Stop Server** controls the bundled process.
- **Start at Login** registers the app with `SMAppService`.
- **Quit Plexy Server** stops the server and exits.

The server uses `~/Library/Application Support/Plexy` for its database and
`~/Library/Logs/Plexy` for logs. It reuses a Plexy server already answering on
the preferred port instead of opening the same store twice. Set
`PLEXY_SERVER_PORT` to choose a different starting port, or
`PLEXY_SERVER_RESOURCES` to point development builds at `dist/server`.

The app bundles the backend; it does not use the Plexy client's data directory.
The client keeps its own native catalog in the `Player` subdirectory.

## Package

The app is ad-hoc signed. Gatekeeper may ask for approval when the DMG is
downloaded. The login item registration also requires the app to be signed and
placed in Applications. Test both on a clean Mac before publishing.

## Layout

| Path | Role |
| --- | --- |
| `Sources/main.swift` | AppKit status item, server process, menu actions, login item |
| `Resources/status-icon.png` | Template menu bar icon |
| `../../scripts/package-server-macos.ts` | Swift compile, app bundle, server resources, DMG |
