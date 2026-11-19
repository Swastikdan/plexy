/// Window shape for the desktop shell. The contract itself is shared with the
/// Electron main and preload processes in @plexy/desktop-bridge.
import type { ElectronAPI } from "@plexy/desktop-bridge";

export type {
  DesktopSystemUsage,
  ElectronAPI,
  NativeAudioTrack,
  NativeCommandRequest,
  NativePlaybackEvent,
  NativePlaybackInfo,
  NativePlayRequest,
  NativePlayResult,
  NativePlayerBridge,
  UpdateProgress as DesktopUpdateProgress,
  UpdateStatus as DesktopUpdateStatus,
} from "@plexy/desktop-bridge";

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
