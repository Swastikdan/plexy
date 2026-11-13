/// Live settings for the offline library cache and its sync triggers.
///
/// The image cache is always on; the server-owned preferences only tune its
/// budget and concurrency. The catalog records are refreshed by
/// `library-cache.ts` on app start, after a scan finishes, and on demand from
/// Settings.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../queries";
import {
  localPrefetchContext,
  PREFETCH_DEFAULTS,
  reconcilePrefetchCache,
  setPrefetchRuntime,
} from "./asset-prefetch";
import { getLastSyncedAt, syncLibrary } from "./library-cache";

/** Re-sync a library that has not been refreshed in this long. */
const SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/**
 * Keep cache budget/concurrency in step with the saved server settings. Only
 * the local owner can read them; everyone else keeps the defaults.
 */
export function usePrefetchRuntime(): void {
  const local = localPrefetchContext();
  const { data } = useQuery({
    ...queries.settings(),
    enabled: local,
    staleTime: 5 * 60_000,
  });

  // The shared app-shell worker (registered in `main.tsx`) also serves this
  // cache, so there is only ever one registration on the root scope.
  useEffect(() => {
    void reconcilePrefetchCache();
  }, []);

  useEffect(() => {
    if (!data) {
      setPrefetchRuntime({
        enabled: true,
        maxConcurrent: PREFETCH_DEFAULTS.maxConcurrent,
        maxCacheMb: PREFETCH_DEFAULTS.maxCacheMb,
      });
      return;
    }
    const settings = data.settings;
    setPrefetchRuntime({
      enabled: true,
      maxConcurrent: clamp(settings.prefetchMaxConcurrent, 1, 10, PREFETCH_DEFAULTS.maxConcurrent),
      maxCacheMb: clamp(settings.prefetchMaxCacheMb, 10, 500, PREFETCH_DEFAULTS.maxCacheMb),
    });
  }, [data]);
}

/**
 * Pull the catalog into the offline cache on first load, when it is stale, and
 * whenever a scan finishes. The player route is skipped by `syncLibrary`.
 */
export function useLibrarySync(): void {
  const { data: status } = useQuery({ ...queries.serverStatus(), staleTime: 5_000 });
  const previousScan = useRef<string | null>(null);

  useEffect(() => {
    const last = getLastSyncedAt();
    if (!last || Date.now() - last > SYNC_MAX_AGE_MS) void syncLibrary();
  }, []);

  useEffect(() => {
    const scan = status?.scan?.status ?? null;
    if (previousScan.current === "running" && scan !== "running") {
      void syncLibrary();
    }
    previousScan.current = scan;
  }, [status?.scan?.status]);
}
