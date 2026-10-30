import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/// Plexy Client (UI-only): the responsive web/PWA artifact.
///
/// Delivery-format decision from the plan's §8: a static client rather than a
/// thin desktop shell, and mobile and desktop UI-only share this one artifact.
/// It therefore must contain nothing the server owns — no backend binary, no
/// migrations, no FFmpeg — which this script verifies after the build.
const FORBIDDEN = ["plexy", "plexy-server", "ffmpeg", "migrations", "bin"];
const REQUIRED = ["index.html", "manifest.webmanifest", "sw.js", "icons"];

async function buildClient(): Promise<void> {
  const root = process.cwd();
  const outDir = join(root, "dist/web");
  const publicDir = join(root, "apps/web/public");

  console.log("Plexy Client (UI-only)");
  console.log("======================");

  if (!existsSync(join(publicDir, "icons", "pwa-512.png"))) {
    console.log("· PWA icons missing, generating from the source artwork");
    execSync("bun scripts/generate-pwa-icons.ts", { stdio: "inherit" });
  }

  console.log("· Building the responsive client");
  execSync("bun run --filter @plexy/web build", { stdio: "inherit" });

  if (!existsSync(outDir)) {
    throw new Error(`Client build produced no output at ${outDir}`);
  }

  const entries = await readdir(outDir);
  const leaked = FORBIDDEN.filter((name) => entries.includes(name));
  if (leaked.length > 0) {
    throw new Error(
      `Plexy Client must not contain server-owned paths, found: ${leaked.join(", ")}`,
    );
  }

  const missing = REQUIRED.filter((name) => !entries.includes(name));
  if (missing.length > 0) {
    throw new Error(`Plexy Client is missing required files: ${missing.join(", ")}`);
  }

  console.log("");
  console.log("✓ Plexy Client built: dist/web");
  console.log("  · Serve this folder over HTTPS (or open a server's own http://localhost).");
  console.log("  · Enter a Plexy Server address, then pair with a six-digit code.");
  console.log("  · No backend binary, migrations, FFmpeg or Electron process is included.");
}

buildClient().catch((error) => {
  console.error(`Build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
