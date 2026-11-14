// Compatibility entry point for existing macOS build commands.
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The macOS release requires an Apple Silicon runner.");
}
await import("./install-ffmpeg.mjs");
