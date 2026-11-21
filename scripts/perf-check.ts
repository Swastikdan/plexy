/// Performance budget check for every Plexy deliverable.
///
/// Reads the artifacts a normal build produces and fails when one grows past
/// its budget. Numbers are deliberately generous (they encode the current
/// post-optimization size plus ~5%) so the check catches regressions without
/// failing on a toolchain bump.
///
///   bun scripts/perf-check.ts             # table, exit 1 on a failed budget
///   bun scripts/perf-check.ts --json      # machine-readable report
///   bun scripts/perf-check.ts --no-server # skip the runtime probe
///
/// The runtime probe starts the compiled server on :8999 with a scratch data
/// directory, then measures boot-to-ready, idle RSS, compressed transfer, ETag
/// revalidation, and request throughput. Report output goes to `.perf/`
/// (gitignored); nothing is written next to the artifacts.
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const perfDir = join(root, ".perf");
const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const probes = !args.has("--no-server");

interface Check {
  name: string;
  value: number;
  unit: "MB" | "KB" | "ms" | "req/s" | "count";
  budget?: number;
  direction?: "max" | "min";
  note?: string;
}

const checks: Check[] = [];
const missing: string[] = [];
// Decimal units, matching how artifact sizes are quoted in docs/PERFORMANCE.md.
const MB = 1_000_000;
const KB = 1_000;

function bytes(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function sizeMB(path: string): number | null {
  const value = bytes(path);
  return value === null ? null : value / MB;
}

function add(
  name: string,
  value: number | null,
  unit: Check["unit"],
  budget?: number,
  direction: Check["direction"] = "max",
  note?: string,
) {
  if (value === null || Number.isNaN(value)) {
    missing.push(name);
    return;
  }
  checks.push({ name, value, unit, budget, direction, note });
}

function fmt(value: number, unit: Check["unit"]): string {
  if (unit === "MB") return `${value.toFixed(2)} MB`;
  if (unit === "KB") return `${value.toFixed(0)} KB`;
  if (unit === "ms") return `${value.toFixed(0)} ms`;
  if (unit === "req/s") return `${value.toFixed(0)} req/s`;
  return String(value);
}

// --- Web (single-file document) ------------------------------------------------
const webIndex = join(root, "dist/web/index.html");
if (existsSync(webIndex)) {
  const raw = bytes(webIndex)!;
  // Re-encode for transfer size the way the server will: one-time gzip and
  // brotli. This is cheaper than staging a second build.
  const body = await Bun.file(webIndex).bytes();
  const gz = gzipSync(body, { level: 9 }).byteLength;
  const br = brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength;
  add("web raw", raw / MB, "MB", 2.15, "max", "index.html before transfer encoding");
  add("web gzip", gz / MB, "MB", 0.60, "max", "server one-time gzip");
  add("web brotli", br / MB, "MB", 0.48, "max", "build-time brotli target");
  const text = new TextDecoder().decode(body);
  const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].reduce((n, m) => n + m[1].length, 0);
  const js = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].reduce((n, m) => n + m[1].length, 0);
  add("web inline CSS", css / MB, "MB", 0.48, "max");
  add("web inline JS", js / MB, "MB", 1.70, "max");
  const fonts = [...text.matchAll(/data:font\/[^;]+;base64,([A-Za-z0-9+/=]+)/g)].reduce(
    (n, m) => n + Math.floor((m[1].length * 3) / 4),
    0,
  );
  add("web inline fonts", fonts / KB, "KB", 75, "max");
} else {
  missing.push("dist/web/index.html (run bun run build:web)");
}

// --- Server artifact -----------------------------------------------------------
const serverBin = join(root, "dist/server/plexy-server");
add("server binary", sizeMB(serverBin), "MB", 92, "max", "Bun compile --minify");
add("server ffmpeg", sizeMB(join(root, "dist/server/ffmpeg")), "MB", 62);
add("server web bundle", sizeMB(join(root, "dist/server/web/index.html")), "MB", 2.15);

// --- Desktop artifact ----------------------------------------------------------
const appRoot = join(root, "dist/mac/mac-arm64/Plexy Beta.app");
if (existsSync(appRoot)) {
  const du = (path: string): number => {
    let total = 0;
    const stack = [path];
    while (stack.length) {
      const current = stack.pop()!;
      const info = lstatSync(current, { throwIfNoEntry: false });
      if (!info || info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        for (const entry of readdirSync(current)) stack.push(join(current, entry));
      } else {
        total += info.size;
      }
    }
    return total;
  };
  add("desktop app", du(appRoot) / MB, "MB", 510, "max", "unpacked .app");
  add("desktop payload", du(join(appRoot, "Contents/Resources/bin")) / MB, "MB", 230, "max", "server + ffmpeg + libmpv");
  const dmgDir = join(root, "dist/mac");
  const dmgs = existsSync(dmgDir)
    ? readdirSync(dmgDir).filter((name) => name.endsWith(".dmg")).map((name) => join(dmgDir, name))
    : [];
  if (dmgs.length) {
    dmgs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    add("desktop DMG", sizeMB(dmgs[0]), "MB", 230, "max", dmgs[0].split("/").pop());
  }
} else {
  missing.push("dist/mac/mac-arm64/Plexy Beta.app (run bun run build:desktop)");
}

// --- Mobile artifact -----------------------------------------------------------
const apkDir = join(root, ".build/native");
const gradleApk = join(root, "apps/mobile/android/app/build/outputs/apk/release/app-release.apk");
const apks = existsSync(apkDir)
  ? readdirSync(apkDir)
      .filter((name) => name.endsWith(".apk"))
      .map((name) => join(apkDir, name))
  : [];
if (existsSync(gradleApk)) apks.push(gradleApk);
apks.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (apks[0]) {
  add("mobile APK", sizeMB(apks[0]), "MB", 45, "max", apks[0].split("/").pop());
} else {
  missing.push(".build/native/*.apk (run bun run build:mobile)");
}

// --- Runtime probes ------------------------------------------------------------
async function probeServer() {
  if (!existsSync(serverBin)) return;
  // Warm the freshly compiled executable into the file cache: the first run
  // after a build can take ~1 s while the 86 MB binary is read from disk.
  await Bun.spawn([serverBin, "--version"], { stdout: "ignore", stderr: "ignore" }).exited;
  const port = 8999;
  const dataDir = join(perfDir, "check-data");
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const started = performance.now();
  const child = Bun.spawn([serverBin], {
    env: { ...process.env, PORT: String(port), PLEXY_DATA_DIR: dataDir, PLEXY_LOG_LEVEL: "error" },
    stdout: "ignore",
    stderr: "ignore",
  });
  let ready = -1;
  for (let i = 0; i < 300; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(200),
      });
      if (response.status) {
        ready = performance.now() - started;
        break;
      }
    } catch {
      await Bun.sleep(10);
    }
  }
  if (ready < 0) {
    child.kill();
    missing.push("server runtime probe (did not become ready)");
    return;
  }
  add("server boot", ready, "ms", 500);
  const rss = Number(
    (await Bun.$`ps -o rss= -p ${child.pid}`.text()).trim(),
  );
  add("server idle RSS", rss / 1024, "MB", 70);

  // First-load transfer with and without compression. Bun's fetch transparently
  // decompresses, so read the header rather than the body length.
  const plain = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { "Accept-Encoding": "identity" },
  });
  const gz = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { "Accept-Encoding": "gzip" },
  });
  const br = await fetch(`http://127.0.0.1:${port}/`, {
    headers: { "Accept-Encoding": "br" },
  });
  add(
    "server / transfer (brotli)",
    Number(br.headers.get("content-length") ?? 0) / MB,
    "MB",
    0.48,
    "max",
    br.headers.get("content-encoding") ?? "not encoded",
  );
  add(
    "server / transfer (gzip)",
    Number(gz.headers.get("content-length") ?? 0) / MB,
    "MB",
    0.60,
    "max",
    gz.headers.get("content-encoding") ?? "not encoded",
  );
  add("server / transfer (raw)", Number(plain.headers.get("content-length") ?? 0) / MB, "MB");
  const etag = gz.headers.get("etag") ?? plain.headers.get("etag") ?? "";
  if (etag) {
    const revalidated = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "If-None-Match": etag, "Accept-Encoding": "gzip" },
    });
    add("server ETag revalidate", revalidated.status === 304 ? 1 : 0, "count", 1, "min", `HTTP ${revalidated.status}`);
  } else {
    missing.push("server ETag (not sent)");
  }

  // Loopback throughput on the API surface (unauthenticated 401 path).
  const timed = performance.now();
  const requests = 500;
  await Promise.all(
    Array.from({ length: 50 }, async () => {
      for (let i = 0; i < requests / 50; i++) {
        await fetch(`http://127.0.0.1:${port}/api/health`);
      }
    }),
  );
  const seconds = (performance.now() - timed) / 1000;
  add("server API throughput", requests / seconds, "req/s", 8000, "min");

  child.kill();
  await rm(dataDir, { recursive: true, force: true });
}

if (probes) await probeServer();

// --- Report --------------------------------------------------------------------
const failures = checks.filter(
  (c) => c.budget !== undefined && (c.direction === "min" ? c.value < c.budget : c.value > c.budget),
);

const report = {
  generatedAt: new Date().toISOString(),
  checks,
  missing,
  failures: failures.map((f) => f.name),
  ok: failures.length === 0,
};

if (json) {
  await mkdir(perfDir, { recursive: true });
  await Bun.write(join(perfDir, "perf-check.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} else {
  const width = Math.max(...checks.map((c) => c.name.length), 5);
  console.log(`\nPlexy performance budgets (${new Date().toISOString().slice(0, 10)})\n`);
  console.log(`${"metric".padEnd(width)}  ${"value".padStart(12)}  ${"budget".padStart(12)}  status`);
  console.log(`${"-".repeat(width)}  ${"-".repeat(12)}  ${"-".repeat(12)}  ------`);
  for (const c of checks) {
    const status =
      c.budget === undefined
        ? "—"
        : (c.direction === "min" ? c.value >= c.budget : c.value <= c.budget)
          ? "ok"
          : "FAIL";
    console.log(
      `${c.name.padEnd(width)}  ${fmt(c.value, c.unit).padStart(12)}  ${(c.budget !== undefined ? fmt(c.budget, c.unit) : "—").padStart(12)}  ${status}${c.note ? `  (${c.note})` : ""}`,
    );
  }
  if (missing.length) {
    console.log(`\nskipped:\n${missing.map((m) => `  · ${m}`).join("\n")}`);
  }
  console.log(failures.length ? `\n${failures.length} budget(s) failed.` : "\nAll budgets pass.");
  await mkdir(perfDir, { recursive: true });
  await Bun.write(join(perfDir, "perf-check.md"), checks.map((c) => `${c.name}\t${c.value}\t${c.unit}`).join("\n") + "\n");
}

process.exit(failures.length ? 1 : 0);
