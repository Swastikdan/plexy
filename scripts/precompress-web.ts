/// Emit transfer-encoded copies of the single-file web document next to it.
///
/// The server prefers `index.html.br` / `index.html.gz` when present, so a
/// production build pays zero compression cost at boot and brotli-capable
/// clients get the smallest representation. Both files are derived artifacts;
/// `dist/` is gitignored.
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const index = join(root, "dist", "web", "index.html");

const info = await stat(index).catch(() => null);
if (!info?.isFile()) {
  console.error("precompress-web: dist/web/index.html is missing; run the web build first.");
  process.exit(1);
}

const body = await readFile(index);
const brotli = brotliCompressSync(body, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
  },
});
const gzip = gzipSync(body, { level: 9 });

await writeFile(`${index}.br`, brotli);
await writeFile(`${index}.gz`, gzip);

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;
console.log(
  `✓ precompressed dist/web/index.html: ${kb(body.byteLength)} raw → ${kb(gzip.byteLength)} gzip / ${kb(brotli.byteLength)} brotli`,
);
