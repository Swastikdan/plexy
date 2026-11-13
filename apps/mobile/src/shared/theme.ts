import { processColor } from "react-native";
import { useThemeColor } from "heroui-native";

// Resolve raw color props from the same HeroUI tokens as Tailwind utilities.
// This hook subscribes each consumer to theme changes, including native icons.
export function useColors() {
  const [canvas, surface, elevated, hover, ink, muted, line, brand, amber, danger, success] =
    useThemeColor(["background", "surface", "surface-secondary", "surface-hover",
      "foreground", "muted", "border", "accent", "warning", "danger", "success"]);
  return { canvas, surface, elevated, hover, ink, muted, quiet: muted, line,
    brand, brandLight: brand, brandDark: brand, amber, danger, success };
}

// React Native resolves HeroUI colors before applying alpha for gradients.
export function withAlpha(color: string, opacity: number) {
  const value = processColor(color);
  if (typeof value !== "number") return color;
  const rgb = value >>> 0;
  return `rgba(${(rgb >>> 16) & 255}, ${(rgb >>> 8) & 255}, ${rgb & 255}, ${opacity})`;
}

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
