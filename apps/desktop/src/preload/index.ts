import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "../types";

const api: ElectronAPI = {
  isElectron: true,
  localOnly: true,
  discoverServers: () => ipcRenderer.invoke("app:discover-servers"),
  platform: process.platform,
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  openLogs: () => ipcRenderer.invoke("app:open-logs"),
  openDataDir: () => ipcRenderer.invoke("app:open-data-dir"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  onUpdateProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress);
    ipcRenderer.on("app:update-progress", handler);
    return () => ipcRenderer.removeListener("app:update-progress", handler);
  },
  getSystemUsage: () => ipcRenderer.invoke("app:get-system-usage"),
  getServerUrl: () => ipcRenderer.invoke("app:get-server-url"),
  setServerUrl: (url: string) => ipcRenderer.invoke("app:set-server-url", url),
  isFullScreen: () => ipcRenderer.invoke("app:is-fullscreen"),
  onFullScreenChange: (callback: (isFullScreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) => {
      callback(isFullScreen);
    };
    ipcRenderer.on("fullscreen-change", handler);
    return () => {
      ipcRenderer.removeListener("fullscreen-change", handler);
    };
  },
  onNavigate: (callback: (route: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, route: string) => {
      callback(route);
    };
    ipcRenderer.on("navigate", handler);
    return () => {
      ipcRenderer.removeListener("navigate", handler);
    };
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
