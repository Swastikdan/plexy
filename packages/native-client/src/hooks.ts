import { useEffect, useState } from "react";
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  keys: React.DependencyList,
) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    setError(null);
    setValue(null);
    void load(controller.signal)
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live && !controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not load this screen.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [...keys, revision]);
  return { value, error, loading, retry: () => setRevision((n) => n + 1) };
}
