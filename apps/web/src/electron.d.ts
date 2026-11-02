export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  selectFolder: () => Promise<string | null>;
  openLogs: () => Promise<void>;
  openDataDir: () => Promise<void>;
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<DesktopUpdateStatus>;
  installUpdate: () => Promise<void>;
  getSystemUsage: () => Promise<DesktopSystemUsage>;
  getServerUrl: () => Promise<string>;
  setServerUrl: (url: string) => Promise<void>;
  onNavigate: (callback: (route: string) => void) => () => void;
  isFullScreen?: () => Promise<boolean>;
  onFullScreenChange?: (callback: (isFullScreen: boolean) => void) => () => void;
}

export interface DesktopUpdateStatus {
  supported: boolean;
  currentVersion: string;
  currentTag: string;
  latestVersion?: string;
  latestTag?: string;
  updateAvailable: boolean;
  currentIsNewer: boolean;
  canInstall: boolean;
  error?: string;
}

export interface DesktopSystemUsage {
  cpuPercent: number;
  appMemoryBytes: number;
  appGpuMemoryBytes: number;
  systemMemoryTotalBytes: number;
  systemMemoryFreeBytes: number;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
