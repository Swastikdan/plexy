import { useEffect,useId,useRef,useState } from "react";
import { resourceKey } from "./resource-key";

const resourceCache = new Map<string, any>();

const invalidations = new Set<() => void>();

export function invalidateLocalResources() {
  resourceCache.clear();
  for (const invalidate of invalidations) invalidate();
}

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  keys: React.DependencyList,
  namespace?: string,
) {
  const instance = useId();
  const cacheKey = resourceKey(namespace || instance, keys);
  const cached = resourceCache.get(cacheKey) as T | undefined;
  const [value, setValue] = useState<T | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cached === undefined);
  const [revision, setRevision] = useState(0);
  const previousKey = useRef(cacheKey);
  useEffect(() => {
    const invalidate = () => setRevision((n) => n + 1);
    invalidations.add(invalidate);
    return () => {
      invalidations.delete(invalidate);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    // Keep mounted consumers (especially playback) alive during invalidation.
    // A changed query may show a loader; a refreshed query retains its last value.
    if (previousKey.current !== cacheKey) {
      setLoading(!resourceCache.has(cacheKey));
      setValue((resourceCache.get(cacheKey) as T | undefined) ?? null);
      previousKey.current = cacheKey;
    }
    setError(null);
    void load(controller.signal)
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
  }, [...keys, revision, cacheKey]);
  return { value, error, loading, retry: () => setRevision((n) => n + 1) };
}
