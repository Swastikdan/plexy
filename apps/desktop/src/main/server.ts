import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { getAvailablePort } from "./port";

let serverProcess: ChildProcess | null = null;
let activePort = 0;

export function getActivePort(): number {
  return activePort;
}

/** Poll /api/server/status until healthy or timeout */
async function waitForServer(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/api/server/status`;

  while (Date.now() - start < timeoutMs) {
    // If the server process died early, stop waiting
    if (serverProcess && (serverProcess.killed || serverProcess.exitCode !== null)) {
      return false;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

/** Find repo root by looking for apps/server/src/main.ts upwards from multiple anchors */
function findRepoRoot(): string {
  const anchors = [process.cwd(), __dirname, app.getAppPath()];
  for (const anchor of anchors) {
    let cur = path.resolve(anchor);
    for (let depth = 0; depth < 6; depth++) {
      if (existsSync(path.join(cur, "apps/server/src/main.ts"))) {
        return cur;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return process.cwd();
}

/** Resolve the dev server entry file */
function resolveDevServerEntry(): string {
  const root = findRepoRoot();
  const candidate = path.join(root, "apps/server/src/main.ts");
  if (existsSync(candidate)) return candidate;

  // Fallback checks
  const fallbacks = [
    path.resolve(process.cwd(), "apps/server/src/main.ts"),
    path.resolve(__dirname, "../../../apps/server/src/main.ts"),
    path.resolve(__dirname, "../../apps/server/src/main.ts"),
    path.resolve(__dirname, "../server/src/main.ts"),
  ];
  for (const fb of fallbacks) {
    if (existsSync(fb)) return fb;
  }
  return candidate;
}

/** Resolve the backend server executable path for packaged production app */
function resolveServerBinary(): string | null {
  const candidates = [
    path.join(process.resourcesPath, "bin", "plexy-server"),
    path.join(process.resourcesPath, "plexy-server"),
    path.join(app.getAppPath(), "..", "bin", "plexy-server"),
    path.join(process.cwd(), "dist", "bin", "plexy-server"),
    path.join(process.cwd(), "dist", "plexy"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Resolve bun binary path on macOS even when launched from GUI environments without ~/.bun/bin in PATH */
function resolveBunBinary(): string {
  const home = process.env.HOME || "";
  const candidates = [
    process.env.BUN_PATH,
    path.join(home, ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "bun",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (c === "bun" || existsSync(c)) return c;
  }
  return "bun";
}

export async function startServer(): Promise<{ url: string; port: number }> {
  const isDev = !app.isPackaged;

  // Prefer 8765 so LAN bookmarks stay valid; random only if it is taken.
  activePort = await getAvailablePort();

  const dataDir = path.join(app.getPath("appData"), "Plexy");
  const logDir = path.join(app.getPath("logs"), "Plexy");

  const home = process.env.HOME || "";
  const extraPaths = [
    path.join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const augmentedPath = `${extraPaths.join(":")}:${process.env.PATH || ""}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: augmentedPath,
    NODE_ENV: isDev ? "development" : "production",
    PORT: String(activePort),
    PLEXY_DESKTOP: "1",
    PLEXY_DATA_DIR: dataDir,
    PLEXY_LOG_DIR: logDir,
    ...(app.isPackaged ? { PLEXY_RESOURCES_DIR: process.resourcesPath } : {}),
  };

  if (isDev) {
    const serverEntry = resolveDevServerEntry();
    const repoRoot = findRepoRoot();
    const bunBin = resolveBunBinary();

    console.log(`[Plexy Desktop] Spawning dev backend: ${bunBin} run ${serverEntry} on dynamic port ${activePort}`);
    serverProcess = spawn(bunBin, ["run", serverEntry], {
      cwd: repoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    const binary = resolveServerBinary();
    if (!binary) {
      throw new Error(`Could not find plexy-server executable in resources (${process.resourcesPath})`);
    }

    console.log(`[Plexy Desktop] Spawning backend executable: ${binary} on dynamic port ${activePort}`);
    serverProcess = spawn(binary, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  let capturedStderr = "";

  serverProcess.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Server] ${msg}`);
  });

  serverProcess.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      if (capturedStderr.length < 2000) capturedStderr += `\n${msg}`;
      console.error(`[Server ERR] ${msg}`);
    }
  });

  serverProcess.on("exit", (code, signal) => {
    console.log(`[Server] Process terminated with code ${code}, signal ${signal}`);
    serverProcess = null;
  });

  // Wait for server to become healthy on the dynamic port
  const ready = await waitForServer(activePort, 15000);
  if (!ready) {
    const detail = capturedStderr ? `:\n${capturedStderr.trim()}` : "";
    throw new Error(`Plexy backend failed to start on dynamic port ${activePort}${detail}`);
  }

  console.log(`[Plexy Desktop] Backend ready at http://127.0.0.1:${activePort}`);
  return { url: `http://127.0.0.1:${activePort}`, port: activePort };
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.killed || serverProcess.exitCode !== null) {
      serverProcess = null;
      return resolve();
    }

    console.log("[Plexy Desktop] Terminating backend server process...");
    const proc = serverProcess;
    serverProcess = null;

    const killTimer = setTimeout(() => {
      try {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      } catch {}
      resolve();
    }, 2000);

    proc.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });

    try {
      proc.kill("SIGTERM");
    } catch {
      proc.kill("SIGKILL");
      resolve();
    }
  });
}
