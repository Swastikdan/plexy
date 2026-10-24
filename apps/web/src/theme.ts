/// Theme settings — Plexy is exclusively dark cinema theme.
export type Theme = "dark";

export function getTheme(): Theme {
  return "dark";
}

export function setTheme(_theme?: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = "dark";
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", "dark");
  }
}
