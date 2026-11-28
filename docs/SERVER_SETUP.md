# Plexy Server setup and migration

Plexy Server is the standalone backend and bundled web UI. The same process
serves the API, browser app, artwork, subtitles, and streams. Android, Plexy,
and separately hosted web builds connect to it over the network.

The release archive contains:

| File | Role |
| --- | --- |
| `plexy-server` | Server executable |
| `ffmpeg` | Media probe and playback preparation |
| `migrations/` | SQLite schema migrations, applied on startup |
| `web/` | Built browser UI |

Keep these files together. Runtime state lives outside the archive in the data
directory.

## Fresh install

### macOS (Apple Silicon)

1. Download `plexy-server-macos-arm64.tar.gz` and `SHA256SUMS` from the release.
2. Verify the archive:
   ```sh
   shasum -a 256 -c SHA256SUMS --ignore-missing
   tar -xzf plexy-server-macos-arm64.tar.gz
   ```
3. Move the extracted folder to a stable location, for example
   `~/Applications/Plexy Server`.
4. Start it:
   ```sh
   cd "$HOME/Applications/Plexy Server"
   ./plexy-server
   ```
   The default data directory is `~/Library/Application Support/Plexy`.

### Linux (x64)

1. Download `plexy-server-linux-x64.tar.gz` and `SHA256SUMS`.
2. Verify and extract:
   ```sh
   sha256sum -c SHA256SUMS --ignore-missing
   tar -xzf plexy-server-linux-x64.tar.gz
   ```
3. Move the folder to a stable location, for example
   `~/applications/plexy-server`.
4. Start it:
   ```sh
   cd "$HOME/applications/plexy-server"
   ./plexy-server
   ```
   The default data directory is `${XDG_DATA_HOME:-$HOME/.local/share}/plexy`
   and logs go to `${XDG_STATE_HOME:-$HOME/.local/state}/plexy/logs`.

`PORT` changes the default `8765` port. `PLEXY_DATA_DIR` and `PLEXY_LOG_DIR`
override the data and log directories. `PLEXY_NO_UI=1` or `--no-ui` serves the
API only.

## First-run setup

1. Open `http://localhost:8765/setup` on the machine running the server. The
   owner account can only be created from loopback.
2. Create the owner username and password.
3. Add a movie or TV library and at least one root folder. Scanning starts
   automatically.
4. Optional: add a TMDB token in Server settings for metadata and artwork.
5. Open `http://localhost:8765` to use the bundled web UI.

The browser UI is the same build that ships with Plexy. Do not open `web/`
through a separate static server; the API and UI must share an origin, or the
API must be configured with `PLEXY_ALLOWED_ORIGINS`.

## LAN access and pairing

1. In **Settings → Server → Network & security**, set **LAN Access (Bind
   Address)** to `0.0.0.0 (Allow LAN devices on Wi-Fi)`.
2. Restart the server and copy the `https://<address>:<port+1>` line it prints.
   LAN traffic uses TLS with a self-signed certificate; `http://` LAN addresses
   do not work.
3. On another device, open the HTTPS address and accept the server certificate,
   or enter the address in the Plexy client’s connection screen. On Android,
   install the server certificate as a user CA first: open
   `https://<address>:<port+1>/api/server/certificate`, download the PEM file,
   then install it under **Settings → Security → Encryption & credentials →
   Install a certificate → CA certificate**. Plexy’s Android network policy
   trusts user-installed CAs; cleartext traffic stays disabled.
4. In **Settings → Devices**, create a pairing code, or sign in with the owner
   or viewer account. Pairing returns a device token; the server stores only a
   hash and the token can be revoked from the same panel.

`PLEXY_ALLOWED_ORIGINS` is only for a web UI hosted on a different origin. The
bundled UI and the Android app do not need it.

## Data and backups

The data directory contains:

| Path | Contents |
| --- | --- |
| `library.sqlite` | Libraries, items, accounts, devices, watch state, collections, settings |
| `config.json` | Server settings, including the port, bind address, and TMDB token |
| `artwork/` | Cached original and derived artwork |
| `optimized/` | Prepared MP4 copies and extracted subtitles |
| `trickplay/` | Scrub-preview frames |
| `backups/` | Automatic database snapshots taken before migrations |
| `lan-certificate.pem`, `lan-key.pem` | LAN TLS identity |

Stop the server before copying the database. For a consistent backup, use
SQLite’s backup command rather than copying a live WAL database:

```sh
sqlite3 "$DATA_DIR/library.sqlite" ".backup '$BACKUP_DIR/library.sqlite'"
```

Copy `config.json` and the `artwork/`, `optimized/`, and `trickplay/` folders
with the backup if you want to avoid re-downloading and re-preparing media. The
server keeps the two most recent pre-migration snapshots in `backups/`.

## Move an existing library

### From the Electron app (macOS)

The Electron app and the standalone server use the same macOS data directory:
`~/Library/Application Support/Plexy`.

1. Quit Plexy completely so the bundled server stops.
2. Back up the data directory using the SQLite command above.
3. Start Plexy Server. It reads the existing database and configuration; no
   copy is required.
4. Confirm every library root still exists at the recorded path. If media
   moved, update the root in the server UI and rescan.
5. Keep the Electron app and its backup until playback, accounts, and watch
   state are verified. Do not run Electron and the standalone server against
   the same data directory at the same time.

### From the Electron app (Linux)

Electron stores its data in `~/.config/Plexy`. The standalone server uses
`${XDG_DATA_HOME:-$HOME/.local/share}/plexy`. With both apps stopped:

```sh
mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/plexy"
cp -a "$HOME/.config/Plexy/." "${XDG_DATA_HOME:-$HOME/.local/share}/plexy/"
```

Then confirm `library.sqlite`, `config.json`, and the media cache folders are
present, start the server, and check the library roots.

### From another standalone server

Point `PLEXY_DATA_DIR` at the existing data directory instead of copying it:

```sh
PLEXY_DATA_DIR=/srv/plexy ./plexy-server
```

Use one server process per data directory.

## Upgrade the server

1. Stop the running server.
2. Back up the data directory.
3. Replace the executable, `ffmpeg`, `migrations/`, and `web/` with the new
   archive’s files. Keep the data directory unchanged.
4. Start the server. Pending migrations run automatically, after the automatic
   snapshot.
5. Open the bundled UI and confirm libraries, accounts, and playback.

New optional or feature releases do not change the data location. Do not delete
`backups/` until the upgraded server has served a scan and a playback session.

## Run headless

Use `--no-ui` when only API clients are needed:

```sh
PLEXY_DATA_DIR=/srv/plexy ./plexy-server --no-ui
```

For a service manager, run the executable with a stable working directory and
`PLEXY_DATA_DIR`, send `SIGTERM` to stop it, and keep `web/`, `migrations/`, and
`ffmpeg` beside the executable even in API-only mode. The server performs a
soft shutdown on `SIGTERM`.

## Troubleshooting

- **Port already in use:** set `PORT` to another value. The LAN listener uses
  `port + 1` unless `PLEXY_LAN_PORT` overrides it.
- **LAN address does not load:** use `https://`, not `http://`, and make sure
  the bind address is `0.0.0.0`. Check the firewall for both ports.
- **Owner setup is rejected:** create the owner from the server machine’s
  loopback address. Remote setup is intentionally blocked.
- **Artwork or playback is missing after a move:** check the library roots and
  run a rescan. Prepared files in `optimized/` are a cache and can be rebuilt.
- **An upgrade fails:** stop the server, restore the pre-upgrade database from
  `backups/`, and run the previous executable with the same data directory.

## Verification checklist

- Fresh archive: `./plexy-server --version`, `/api/server/status`, `/setup`, and
  the bundled UI return successfully.
- Owner and viewer sign-in, pairing, device revocation, and a restart preserve
  the session and watch state.
- LAN HTTPS serves the UI, artwork, subtitles, and byte-range streams.
- A scan finds the fixture, playback starts, and seeking returns `206`.
- `bun run test:server` and `bun run smoke:playback` pass in the repository.
