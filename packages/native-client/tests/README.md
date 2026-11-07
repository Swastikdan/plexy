Run from the repository root: `bun run test:native`.

These tests exercise API/auth boundaries, live-conversion seek offsets, subtitle
and trickplay parsing, transfer integrity, and offline progress concurrency.
They do not verify hardware playback, orientation or Android TV remote behavior.
Use the device matrix in `docs/NATIVE_CLIENT_README.md` before release.
