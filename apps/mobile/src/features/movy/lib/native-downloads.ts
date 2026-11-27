import { requireOptionalNativeModule } from "expo";
import type {
  NativeDownloadProgress,
  NativeDownloadResult,
  NativeDownloadState,
} from "./types";

export interface NativeDownloadJob {
  id: string;
  url: string;
  destination: string;
  expectedBytes: number | null;
  etag: string | null;
  title: string;
  display: string;
  accountUsername: string;
  multiStream: boolean;
  wifiOnly: boolean;
}

interface NativeEvents {
  onProgress: (event: NativeDownloadProgress) => void;
  onCompleted: (event: NativeDownloadResult) => void;
  onFailed: (event: { id: string; error: string }) => void;
}

interface PlexyDownloadsModule {
  addListener<E extends keyof NativeEvents>(
    event: E,
    listener: NativeEvents[E],
  ): { remove(): void };
  start(jobJson: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  state(): Promise<NativeDownloadState[]>;
  completed(): Promise<NativeDownloadResult[]>;
  clearCompleted(id: string): Promise<void>;
}

export const nativeDownloads =
  requireOptionalNativeModule<PlexyDownloadsModule>("PlexyDownloads");

export function hasNativeDownloads(): boolean {
  return nativeDownloads != null;
}
