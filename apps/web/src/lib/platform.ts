/// Platform checks shared by chrome-less screens and the app header.
export function isElectronMac(): boolean {
  if (typeof window === "undefined") return false;
  const electron = Boolean(window.electronAPI?.isElectron) || /Electron/i.test(navigator.userAgent);
  const mac = window.electronAPI?.platform === "darwin" || /Mac/i.test(navigator.userAgent);
  return electron && mac;
}
