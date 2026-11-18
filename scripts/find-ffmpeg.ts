import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// Support Bun, pnpm, and flat node_modules layouts used for packaging.
export async function findFfmpeg(rootDir: string): Promise<string | null> {
  const candidates = [
    join(rootDir, "node_modules/node-av/binary/ffmpeg"),
    join(rootDir, "node_modules/.pnpm/node_modules/node-av/binary/ffmpeg"),
  ];

  try {
    const require = createRequire(join(rootDir, "package.json"));
    const packageJson = require.resolve("node-av/package.json");
    candidates.unshift(join(dirname(packageJson), "binary", "ffmpeg"));
  } catch {
    /* fall through to the known layouts */
  }

  try {
    const bunStore = join(rootDir, "node_modules", ".bun");
    for (const entry of await readdir(bunStore)) {
      if (entry.startsWith("node-av@")) {
        candidates.push(
          join(bunStore, entry, "node_modules/node-av/binary/ffmpeg"),
        );
      }
    }
  } catch {
    /* not installed with Bun */
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
