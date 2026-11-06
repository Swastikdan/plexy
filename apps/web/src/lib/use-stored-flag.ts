import { useState } from "react";

/** A per-device boolean stored in localStorage under one key. */
export function useStoredFlag(key: string): [boolean, () => void] {
  const [value, setValue] = useState(() =>
    typeof window === "undefined" ? false : localStorage.getItem(key) === "true",
  );
  const toggle = () =>
    setValue((previous) => {
      const next = !previous;
      localStorage.setItem(key, String(next));
      return next;
    });
  return [value, toggle];
}
