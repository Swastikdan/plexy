/// Theme preference: light, dark, or follow the system.
///
/// The same script that resolves this before first paint lives in
/// `index.html`; keep the storage key and tokens in sync with it. Both the web
/// build and the Electron container share this module — the desktop shell only
/// changes corner geometry (see `styles.css`), never the palette.
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "plexy.theme";

/** Canvas colour for each theme, mirrored by the pre-paint script. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#f5f5f5",
  dark: "#060607",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** Write the resolved theme to the document without touching storage. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", "light dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[resolved]);
  return resolved;
}

/** Persist the preference and apply it immediately. */
export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, locked profile); the theme
    // still applies for this session.
  }
  return applyTheme(preference);
}

/** Re-apply when the OS palette changes while following the system. */
export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const listener = () => {
    if (getThemePreference() === "system") onChange();
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
