import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ItemCard } from "@/core/library/catalog-api";
import type { DownloadButtonState } from "@/core/downloads/state";
import { useServer } from "./server-provider";
import { serverSourceId } from "./server-catalog";
import {
  downloadServerItem,
  findServerDownloadFor,
  loadServerDownloads,
  pauseServerDownload,
  removeServerDownload,
  resumeServerDownload,
  serverDownloadsSnapshot,
  subscribeServerDownloads,
  type ServerDownloadRecord,
} from "./server-downloads";

interface ServerDownloadContext {
  ready: boolean;
  records: ServerDownloadRecord[];
  stateFor(fileId: number | null | undefined): DownloadButtonState;
  progressFor(fileId: number | null | undefined): number;
  toggle(item: ItemCard): Promise<void>;
  remove(id: string): Promise<void>;
  error: string | null;
  clearError(): void;
}

const Context = createContext<ServerDownloadContext | null>(null);

export function ServerDownloadProvider({ children }: React.PropsWithChildren) {
  const { session } = useServer();
  const records = useSyncExternalStore(
    subscribeServerDownloads,
    serverDownloadsSnapshot,
    serverDownloadsSnapshot,
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadServerDownloads().finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const stateFor = useCallback(
    (fileId: number | null | undefined) => {
      if (fileId == null) return "idle" as const;
      const record = findServerDownloadFor(serverSourceId(fileId));
      if (!record) return "idle" as const;
      if (record.status === "completed") return "done" as const;
      if (record.status === "downloading") return "downloading" as const;
      if (record.status === "paused") return "paused" as const;
      if (record.status === "failed") return "failed" as const;
      return "queued" as const;
    },
    [],
  );

  const progressFor = useCallback(
    (fileId: number | null | undefined) => {
      if (fileId == null) return 0;
      return findServerDownloadFor(serverSourceId(fileId))?.progress ?? 0;
    },
    [],
  );

  const toggle = useCallback(
    async (item: ItemCard) => {
      if (!session) throw new Error("Connect to Plexy Server first.");
      if (item.fileId == null) throw new Error("No downloadable file for this title.");
      const fileId = serverSourceId(item.fileId);
      const record = findServerDownloadFor(fileId);
      try {
        if (record?.status === "downloading")
          await pauseServerDownload(record.id);
        else if (record?.status === "paused")
          await resumeServerDownload(session, record.id);
        else if (record?.status !== "completed")
          await downloadServerItem(session, item);
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Download failed.",
        );
        throw caught;
      }
    },
    [session],
  );

  const remove = useCallback(async (id: string) => {
    await removeServerDownload(id);
  }, []);

  const value = useMemo<ServerDownloadContext>(
    () => ({
      ready,
      records,
      stateFor,
      progressFor,
      toggle,
      remove,
      error,
      clearError: () => setError(null),
    }),
    [error, progressFor, ready, records, remove, stateFor, toggle],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useServerDownloads() {
  const value = useContext(Context);
  if (!value) throw new Error("ServerDownloadProvider is missing");
  return value;
}
