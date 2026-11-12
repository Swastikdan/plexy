// Plexy native theme — Driftboard true-dark: near-black shell, charcoal cards,
// cool off-white type, desktop blue accents.
export const colors = {
  canvas: "#0b0c0e",
  surface: "#16181c",
  elevated: "#1d2025",
  hover: "#22252b",
  ink: "#f2f4f7",
  muted: "#171717",
  quiet: "#6e717a",
  line: "rgba(233,239,247,0.07)",
  strong: "rgba(59,125,249,0.22)",
  brand: "#3B7DF9", // vibrant Plexy desktop blue
  brandLight: "#6C9FFF", // light blue
  brandDark: "#1F4FCB", // deep blue
  amber: "#e8a33d",
  danger: "#ef5350",
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
