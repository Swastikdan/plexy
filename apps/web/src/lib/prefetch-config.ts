/// Locality gate and live settings for local asset prefetch.
///
/// The six preferences are server-owned (`config.json` via `/api/settings`);
/// this module keeps one runtime snapshot in sync with the same `["settings"]`
/// query the admin UI uses, so a save there takes effect immediately. Whether
/// work may run at all is decided here: Electron, or a page served from a
/// loopback hostname, with the master preference enabled.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../queries";
import {
  getPrefetchRuntime,
  isPrefetchActive,
  localPrefetchContext,
  PREFETCH_DEFAULTS,
  reconcilePrefetchCache,
  registerPrefetchServiceWorker,
  setPrefetchRuntime,
} from "./asset-prefetch";

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/** True when speculative asset work should run for this viewer right now. */
export function shouldPrefetchLocally(): boolean {
  return isPrefetchActive();
}

/** Hover/focus and near-visible triggers each have their own preference. */
export function prefetchTriggerEnabled(trigger: "hover" | "scroll"): boolean {
  const runtime = getPrefetchRuntime();
  if (!runtime || !isPrefetchActive()) return false;
  return trigger === "hover" ? runtime.onHover : runtime.onScroll;
}

/** How many upcoming items a row may warm beyond what is visible. */
export function prefetchWindow(): number {
  return clamp(getPrefetchRuntime()?.nextCount, 1, 20, PREFETCH_DEFAULTS.nextCount);
}

/**
 * Keep the prefetch runtime in step with the saved server settings. Remote
 * viewers never request the loopback-only settings endpoint, so they stay in
 * the disabled state instead of surfacing a 403.
 */
export function usePrefetchRuntime(): void {
  const local = localPrefetchContext();
  const { data } = useQuery({
    ...queries.settings(),
    enabled: local,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!local) {
      setPrefetchRuntime(null);
      return;
    }
    registerPrefetchServiceWorker();
    void reconcilePrefetchCache();
  }, [local]);

  useEffect(() => {
    if (!local || !data) {
      setPrefetchRuntime(null);
      return;
    }
    const settings = data.settings;
    setPrefetchRuntime({
      enabled: settings.prefetchAggressiveLocal !== false,
      maxConcurrent: clamp(settings.prefetchMaxConcurrent, 1, 10, PREFETCH_DEFAULTS.maxConcurrent),
      maxCacheMb: clamp(settings.prefetchMaxCacheMb, 10, 500, PREFETCH_DEFAULTS.maxCacheMb),
      onHover: settings.prefetchOnHover !== false,
      onScroll: settings.prefetchOnScroll !== false,
      nextCount: clamp(settings.prefetchNextCount, 1, 20, PREFETCH_DEFAULTS.nextCount),
    });
  }, [local, data]);
}
