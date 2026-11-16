import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { useCallback,useEffect,useId,useState } from "react";
import { resourceKey } from "./resource-key";

const resourceCache = new Map<string, unknown>();

const invalidations = new Set<() => void>();

export function invalidateLocalResources() {
  resourceCache.clear();
  for (const invalidate of invalidations) invalidate();
}

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  keys: React.DependencyList,
  namespace?: string,
  /** Synchronous value from a background prefetch, used on the first frame. */
  peek?: () => T | null | undefined,
) {
  const instance = useId();
  const cacheKey = resourceKey(namespace || instance, keys);
  const cached = resourceCache.get(cacheKey) as T | undefined;
  const peeked = cached === undefined ? peek?.() ?? undefined : undefined;
  const first = cached ?? peeked;
  const [value, setValue] = useState<T | null>(first ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(first === undefined);
  const [revision, setRevision] = useState(0);
  const [previousKey, setPreviousKey] = useState(cacheKey);
  const loadLatest = useEventCallback(load);
  if (previousKey !== cacheKey) {
    const nextCached = resourceCache.get(cacheKey) as T | undefined;
    const nextPeeked = nextCached === undefined ? peek?.() ?? undefined : undefined;
    setPreviousKey(cacheKey);
    setLoading(nextCached === undefined && nextPeeked === undefined);
    setValue(nextCached ?? nextPeeked ?? null);
    setError(null);
  }
  const retry = useCallback(() => {
    setError(null);
    setRevision(n => n + 1);
  }, []);
  useEffect(() => {
    const invalidate = retry;
    invalidations.add(invalidate);
    return () => {
      invalidations.delete(invalidate);
    };
  }, [retry]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void loadLatest(controller.signal)
      .then((v) => {
        if (live) {
          resourceCache.set(cacheKey, v);
          if (resourceCache.size > 128)
            resourceCache.delete(resourceCache.keys().next().value!);
          setValue(v);
        }
      })
      .catch((e) => {
        if (live && !controller.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "Could not load this screen.",
          );
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [revision, cacheKey, loadLatest]);
  return { value, error, loading, retry };
}
