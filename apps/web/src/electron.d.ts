export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  selectFolder: () => Promise<string | null>;
  openLogs: () => Promise<void>;
  openDataDir: () => Promise<void>;
  getVersion: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  setServerUrl: (url: string) => Promise<void>;
  onNavigate: (callback: (route: string) => void) => () => void;
  isFullScreen?: () => Promise<boolean>;
  onFullScreenChange?: (callback: (isFullScreen: boolean) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
