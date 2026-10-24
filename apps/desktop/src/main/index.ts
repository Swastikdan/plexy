import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setupApplicationMenu } from "./menu";
import { startServer, stopServer } from "./server";
import { startStaticUi } from "./static";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let stopStaticUi: (() => Promise<void>) | null = null;

function serverPreferenceFile(): string {
  return path.join(app.getPath("userData"), "server-preference.json");
}

function isValidServerUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
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
    const url = typeof raw.url === "string" ? raw.url.trim().replace(/\/+$/, "") : "";
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

  console.warn(`[Plexy Desktop] Preload script candidate not found, falling back to ${candidates[0]}`);
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

// Ensure single instance
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
    backgroundColor: "#0c0d12",
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

  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Plexy Desktop] Failed to load UI from ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  // Open external links in default OS browser instead of Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // In development, load Vite dev server if running, otherwise load backend server
  const loadTarget = !app.isPackaged && process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : serverUrl;

  console.log(`[Plexy Desktop] Loading UI from: ${loadTarget}`);
  win.loadURL(loadTarget);

  return win;
}

function setupIpcHandlers() {
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

  ipcMain.handle("app:get-server-url", () => {
    return readServerPreference();
  });

  ipcMain.handle("app:set-server-url", (_event, value: unknown) => {
    writeServerPreference(typeof value === "string" ? value : "");
  });

  ipcMain.handle("app:is-fullscreen", () => {
    return mainWindow?.isFullScreen() ?? false;
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

  try {
    const { url } = await startServer();
    mainWindow = createWindow(url);
  } catch (err) {
    console.error("[Plexy Desktop] Backend unavailable, opening the connection screen:", err);
    await stopServer();

    try {
      const fallback = await startStaticUi();
      stopStaticUi = fallback.close;
      mainWindow = createWindow(fallback.url);
    } catch (fallbackError) {
      console.error("[Plexy Desktop] Could not open the fallback UI:", fallbackError);
      dialog.showErrorBox(
        "Plexy Startup Error",
        `Failed to initialize Plexy:\n${err instanceof Error ? err.message : String(err)}`,
      );
      app.quit();
      return;
    }
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

void app
  .whenReady()
  .then(async () => {
    setMacDockIcon();
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
    await stopServer();
    await closeStaticUi();
    app.exit(0);
  }
});

app.on("window-all-closed", async () => {
  if (!app.isPackaged || process.platform !== "darwin") {
    await stopServer();
    await closeStaticUi();
    app.quit();
  }
});

process.on("SIGINT", async () => {
  await stopServer();
  await closeStaticUi();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopServer();
  await closeStaticUi();
  process.exit(0);
});

process.on("exit", () => {
  void stopServer();
  void closeStaticUi();
});
