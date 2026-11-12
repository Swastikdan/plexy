// Theme colors mirror the HeroUI Native default dark theme tokens (see
// global.css). Raw strings are only needed for component color props that
// cannot take class names (icon `color`, gradient `colors`, interpolators) —
// styles themselves must use Tailwind classes with the same token names.
export const colors = {
  canvas: "#060607", // --background (dark)
  surface: "#18181b", // --surface (dark)
  elevated: "#232325", // --surface-secondary (dark)
  hover: "#2a2a2e", // --color-surface-hover (dark)
  ink: "#fcfcfc", // --foreground (snow)
  muted: "#9f9fa9", // --muted
  quiet: "#9f9fa9", // --muted
  line: "#28282c", // --border (dark)
  strong: "#0485f738", // accent at ~22% alpha
  brand: "#0485f7", // --accent (dark)
  brandLight: "#5aabfb", // accent, lightened
  brandDark: "#0365bd", // accent, deepened
  amber: "#f7b750", // --warning (dark)
  danger: "#db3b3e", // --danger (dark)
};
// One shape for every action, including icon-only and playback controls.
export const control = { radius: 999, height: 52, inset: 20 } as const;
// Card radius matching the Driftboard grouped-list look (18px cards).
export const card = { radius: 18 };
import { Easing, Platform } from "react-native";
export const fonts = {
  regular: "Archivo_400Regular",
  medium: "Archivo_500Medium",
  bold: "Archivo_700Bold",
  black: "Archivo_900Black",
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }),
};
export function timeLabel(value: number) {
  const n = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function sizeLabel(n: number) {
  return n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(n / 1024 ** 2)} MB`;
}
export const motion = {
  easeOut: [0.23, 1, 0.32, 1] as const,
  duration: { exit: 100, enter: 180 },
};
export const easings = {
  /** Strong ease-out: fast start, slow settle. Use for entering elements. */
  out: Easing.bezier(...motion.easeOut),
  /** Strong ease-in-out: for elements moving across the screen. */
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  /** iOS-like drawer curve: for slide-in panels from an edge. */
  drawer: Easing.bezier(0.32, 0.72, 0, 1),
  /** Fast ease-in: for dismissal/exit animations. */
  in: Easing.bezier(0.32, 0, 1, 1),
};
