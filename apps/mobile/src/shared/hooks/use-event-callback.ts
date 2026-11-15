import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable event callback with the implementation from the latest committed render. */
export function useEventCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
