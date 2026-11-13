/// React binding for the theme preference.
///
/// Kept tiny on purpose: one state value, one effect, no provider. Every
/// consumer reads the same `plexy.theme` localStorage entry, so separate hook
/// instances stay in sync via the `plexy-theme` window event.
import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeToSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "../theme";

const THEME_EVENT = "plexy-theme";

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(getThemePreference()),
  );

  const sync = useCallback(() => {
    const next = getThemePreference();
    setPreferenceState(next);
    setResolved(applyTheme(next));
  }, []);

  useEffect(() => {
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "plexy.theme") sync();
    };
    const onLocal = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_EVENT, onLocal);
    const unsubscribe = subscribeToSystemTheme(sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_EVENT, onLocal);
      unsubscribe();
    };
  }, [sync]);

  const setPreference = useCallback((next: ThemePreference) => {
    setResolved(setThemePreference(next));
    setPreferenceState(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  return { preference, resolved, setPreference };
}
