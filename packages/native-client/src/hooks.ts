import { useEffect, useRef, useState } from "react";

// In-memory cache for fast screen navigation (stale-while-revalidate)
const resourceCache = new Map<string, any>();

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  keys: React.DependencyList,
) {
  const cacheKey = keys
    .map((k) => (typeof k === "object" && k !== null && "id" in k ? (k as any).id : String(k)))
    .join(":");

  const cached = resourceCache.get(cacheKey) as T | undefined;
  const [value, setValue] = useState<T | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cached === undefined);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    // If no cached value exists, show loading indicator
    if (!resourceCache.has(cacheKey)) {
      setLoading(true);
      setValue(null);
    }
    setError(null);

    void load(controller.signal)
      .then((v) => {
        if (live) {
          resourceCache.set(cacheKey, v);
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
