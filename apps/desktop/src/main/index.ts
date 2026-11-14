import {
  readLocalServerEnabled,
  writeLocalServerEnabled,
} from "./local-server-preference";
import { discoverServers } from "./discovery";
import { installCertificateTrust } from "./certificate-trust";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  net,
} from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setupApplicationMenu } from "./menu";
import { startServer, stopServer } from "./server";
import { startStaticUi } from "./static";
import { ensureDesktopAuth } from "./auth";
import { checkForUpdates, getUpdateStatus } from "./updater";
import { NativePlayerManager } from "./native-player";

// The updater downloads only the published Apple Silicon ZIP, verifies the
// release checksum, then replaces the app bundle while preserving userData.
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let stopStaticUi: (() => Promise<void>) | null = null;

const nativePlayer = new NativePlayerManager((event) => {
  const target = mainWindow;
  if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
    target.webContents.send("native:event", event);
  }
});

/** Only the app's own window may drive native playback, never a web frame. */
function trustedFrameOrigin(event: Electron.IpcMainInvokeEvent): string {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Native playback is only available in the Plexy window");
  }
  const raw = event.senderFrame?.url ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Untrusted native playback request");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Untrusted native playback request");
  }
  return url.origin;
}

function localServerEnabled(): boolean {
  return readLocalServerEnabled(app.getPath("userData"));
}
function saveLocalServerEnabled(enabled: boolean): void {
  writeLocalServerEnabled(app.getPath("userData"), enabled);
}

function serverPreferenceFile(): string {
  return path.join(app.getPath("userData"), "server-preference.json");
}

function isValidServerUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}

/** Read the viewer's chosen server. Empty means "use the bundled server". */
function readServerPreference(): string {
  try {
    const raw = JSON.parse(readFileSync(serverPreferenceFile(), "utf8")) as {
      url?: unknown;
    };
    const url =
      typeof raw.url === "string" ? raw.url.trim().replace(/\/+$/, "") : "";
    return isValidServerUrl(url) ? url : "";
  } catch {
    return "";
  }
}

function writeServerPreference(raw: string): void {
  const file = serverPreferenceFile();
  const url = raw.trim().replace(/\/+$/, "");

  if (!url) {
    try {
      rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
    return;
  }

  if (!isValidServerUrl(url)) {
    throw new Error("Invalid Plexy server address.");
  }

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ url }, null, 2));
}

function resolvePreloadPath(): string {
  const candidates = [
    path.join(app.getAppPath(), "dist", "preload.cjs"),
    path.join(app.getAppPath(), "preload.cjs"),
    path.resolve(__dirname, "../../dist/preload.cjs"),
    path.join(process.resourcesPath, "app.asar", "dist", "preload.cjs"),
    path.join(process.cwd(), "apps/desktop/dist/preload.cjs"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      console.log(`[Plexy Desktop] Using preload script: ${c}`);
      return c;
    }
  }

  console.warn(
    `[Plexy Desktop] Preload script candidate not found, falling back to ${candidates[0]}`,
  );
  return candidates[0];
}

function resolveAppIcon(): string | undefined {
  const bases = [
    process.resourcesPath,
    app.getAppPath(),
    path.join(app.getAppPath(), ".."),
    path.join(app.getAppPath(), "../.."),
    path.join(app.getAppPath(), "resources"),
    process.cwd(),
  ];

  const fileNames = [
    "icon.png",
    "icon.icns",
    "build/icon.png",
    "build/icon.icns",
    "resources/icon.png",
    "resources/icon.icns",
  ];

  for (const base of bases) {
    if (!base) continue;
    for (const file of fileNames) {
      const p = path.resolve(base, file);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

function setMacDockIcon(): void {
  if (process.platform === "darwin" && app.dock) {
    try {
      const iconPath = resolveAppIcon();
      if (iconPath) {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) {
          app.dock.setIcon(img);
          console.log(`[Plexy Desktop] Native dock icon set from: ${iconPath}`);
        }
      }
    } catch (err) {
      console.warn("[Plexy Desktop] Could not set dock icon:", err);
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(serverUrl: string): BrowserWindow {
  const isMac = process.platform === "darwin";
  const iconPath = resolveAppIcon();
  const iconImage = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#060607",
    show: false,
    title: "Plexy",
    ...(iconImage && !iconImage.isEmpty() ? { icon: iconImage } : {}),
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: "under-window",
          visualEffectState: "active",
        }
      : {}),
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  // Safety fallback: if ready-to-show hasn't fired within 1s, show window so it never stays invisible
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }, 1000);

  win.on("enter-full-screen", () => {
    win.webContents.send("fullscreen-change", true);
  });

  win.on("leave-full-screen", () => {
    win.webContents.send("fullscreen-change", false);
  });

  win.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[Plexy Desktop] Failed to load UI from ${validatedURL}: ${errorDescription} (${errorCode})`,
      );
    },
  );

  // Open external links in default OS browser instead of Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  const loadTarget =
    !app.isPackaged && process.env.VITE_DEV_SERVER_URL
      ? process.env.VITE_DEV_SERVER_URL
      : serverUrl;

  console.log(`[Plexy Desktop] Loading UI from: ${loadTarget}`);
  win.loadURL(loadTarget);

  return win;
}

function setupIpcHandlers() {
  ipcMain.handle("app:discover-servers", () => discoverServers());
  ipcMain.handle("dialog:select-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Media Folder",
      buttonLabel: "Add to Plexy",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("app:open-logs", async () => {
    const logDir = path.join(app.getPath("logs"), "Plexy");
    await shell.openPath(logDir);
  });

  ipcMain.handle("app:open-data-dir", async () => {
    const dataDir = path.join(app.getPath("appData"), "Plexy");
    await shell.openPath(dataDir);
  });

  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:get-system-usage", () => {
    const processes = app.getAppMetrics();
    const workingSet = (metric: (typeof processes)[number]) =>
      (metric.memory.workingSetSize ?? 0) * 1024;
    return {
      cpuPercent: processes.reduce(
        (total, metric) => total + (metric.cpu.percentCPUUsage ?? 0),
        0,
      ),
      appMemoryBytes: processes.reduce(
        (total, metric) => total + workingSet(metric),
        0,
      ),
      appGpuMemoryBytes: processes
        .filter((metric) => metric.type.toLowerCase().includes("gpu"))
        .reduce((total, metric) => total + workingSet(metric), 0),
      systemMemoryTotalBytes: os.totalmem(),
      systemMemoryFreeBytes: os.freemem(),
    };
  });

  ipcMain.handle("app:check-for-updates", () => getUpdateStatus());
  ipcMain.handle("app:install-update", (event) =>
    checkForUpdates((progress) => {
      if (!event.sender.isDestroyed())
        event.sender.send("app:update-progress", progress);
    }),
  );

  ipcMain.handle("app:get-server-url", () => {
    return readServerPreference();
  });

  ipcMain.handle("app:set-server-url", async (_event, value: unknown) => {
    // A native stream is bound to the server it started on; stop it before the
    // preference can point the next request somewhere else.
    await nativePlayer.stop();
    writeServerPreference(typeof value === "string" ? value : "");
  });

  ipcMain.handle("app:get-local-server-enabled", () => localServerEnabled());
  let changingServer = false;
  ipcMain.handle(
    "app:set-local-server-enabled",
    async (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean")
        throw new Error("Invalid server preference");
      if (changingServer) throw new Error("Server mode is already changing");
      changingServer = true;
      try {
        await nativePlayer.stop();
        saveLocalServerEnabled(enabled);
        if (enabled) writeServerPreference("");
        // Reopen only after the IPC response reaches the renderer.
        setTimeout(() => {
          void openMainWindow()
            .catch((error) =>
              dialog.showErrorBox("Plexy server mode", String(error)),
            )
            .finally(() => {
              changingServer = false;
            });
        }, 100);
      } catch (error) {
        changingServer = false;
        throw error;
      }
    },
  );
  ipcMain.handle("app:probe-server", async (_event, raw: unknown) => {
    if (typeof raw !== "string" || !isValidServerUrl(raw))
      throw new Error("Invalid server address");
    const response = await net.fetch(
      new URL("/api/server/status", raw).toString(),
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    return response.json();
  });

  ipcMain.handle("app:is-fullscreen", () => {
    return mainWindow?.isFullScreen() ?? false;
  });

  // --- Native (mpv) playback -------------------------------------------------
  ipcMain.handle("native:info", () => nativePlayer.info());
  ipcMain.handle("native:play", async (event, request: Record<string, unknown>) => {
    const serverOrigin = trustedFrameOrigin(event);
    return nativePlayer.play({
      fileId: Number(request?.fileId),
      serverUrl: typeof request?.serverUrl === "string" ? request.serverUrl : serverOrigin,
      serverOrigin,
      resumeSeconds: Number(request?.resumeSeconds) || 0,
      autoSubtitles: request?.autoSubtitles !== false,
      subtitleLanguage: typeof request?.subtitleLanguage === "string" ? request.subtitleLanguage : undefined,
    });
  });
  ipcMain.handle("native:command", async (event, request: Record<string, unknown>) => {
    trustedFrameOrigin(event);
    const action = String(request?.action ?? "");
    if (!["pause", "resume", "seek", "stop", "set-audio"].includes(action)) {
      throw new Error("Unsupported player action");
    }
    return nativePlayer.command({
      sessionId: String(request?.sessionId ?? ""),
      action: action as "pause" | "resume" | "seek" | "stop" | "set-audio",
      value: Number(request?.value) || 0,
    });
  });
  ipcMain.handle("native:stop", async (event, request: Record<string, unknown>) => {
    trustedFrameOrigin(event);
    await nativePlayer.stop(typeof request?.sessionId === "string" ? request.sessionId : undefined);
    return { ok: true };
  });
}

async function closeStaticUi(): Promise<void> {
  const close = stopStaticUi;
  stopStaticUi = null;
  if (close) await close();
}

/**
 * Start the bundled backend and show its UI. If the backend cannot start,
 * serve the built UI statically instead so the connection screen can ask for
 * another Plexy server. This keeps the app usable instead of quitting.
 */
async function openMainWindow(): Promise<void> {
  await closeStaticUi();
  // macOS keeps the app alive after its last window closes. Reopening must
  // replace the existing backend rather than spawning a second one.
  await stopServer();

  const previousWindow = mainWindow;
  try {
    if (!localServerEnabled()) {
      const ui = await startStaticUi(readServerPreference);
      stopStaticUi = ui.close;
      mainWindow = createWindow(ui.url);
    } else {
      const { url } = await startServer();
      // Authenticate before the window loads so the first API call already has a
      // session cookie. A failure is not fatal: the app shows the pairing screen.
      const authenticated = await ensureDesktopAuth(url);
      if (!authenticated) {
        console.warn(
          "[Plexy Desktop] Opening unauthenticated; the pairing screen will be shown.",
        );
      }
      mainWindow = createWindow(url);
    }
  } catch (err) {
    console.error(
      "[Plexy Desktop] Backend unavailable, opening the connection screen:",
      err,
    );
    await stopServer();

    try {
      const fallback = await startStaticUi(readServerPreference);
      stopStaticUi = fallback.close;
      mainWindow = createWindow(fallback.url);
    } catch (fallbackError) {
      console.error(
        "[Plexy Desktop] Could not open the fallback UI:",
        fallbackError,
      );
      dialog.showErrorBox(
        "Plexy Startup Error",
        `Failed to initialize Plexy:\n${err instanceof Error ? err.message : String(err)}`,
      );
      app.quit();
      return;
    }
  }

  const openedWindow = mainWindow;
  openedWindow.on("closed", () => {
    if (mainWindow === openedWindow) mainWindow = null;
    void nativePlayer.stop();
  });
  previousWindow?.destroy();
}

void app
  .whenReady()
  .then(async () => {
    setMacDockIcon();
    installCertificateTrust();
    setupIpcHandlers();
    setupApplicationMenu(() => mainWindow);
    await openMainWindow();
  })
  .catch((err) => {
    console.error("[Plexy Desktop] Startup failed:", err);
    dialog.showErrorBox(
      "Plexy Startup Error",
      `Failed to initialize Plexy:\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !isQuitting) {
    void openMainWindow();
  }
});

app.on("before-quit", async (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();
    await nativePlayer.dispose();
    await stopServer();
    await closeStaticUi();
    app.exit(0);
  }
});

app.on("window-all-closed", async () => {
  if (!app.isPackaged || process.platform !== "darwin") {
    await nativePlayer.dispose();
    await stopServer();
    await closeStaticUi();
    app.quit();
  }
});

process.on("SIGINT", async () => {
  await nativePlayer.dispose();
  await stopServer();
  await closeStaticUi();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await nativePlayer.dispose();
  await stopServer();
  await closeStaticUi();
  process.exit(0);
});

process.on("exit", () => {
  void nativePlayer.dispose();
  void stopServer();
  void closeStaticUi();
});
