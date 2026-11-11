// Plexy native theme — Archivo fonts, pure black & neutral dark gray cinema theme with desktop blue accents.
export const colors = {
  canvas: "#000000",
  surface: "#121212",
  elevated: "#181818",
  hover: "#222222",
  ink: "#ffffff",
  muted: "#9e9e9e",
  quiet: "#5e5e5e",
  line: "rgba(255,255,255,0.08)",
  strong: "rgba(59,125,249,0.22)",
  brand: "#3B7DF9",      // vibrant Plexy desktop blue
  brandLight: "#6C9FFF", // light blue
  brandDark: "#1F4FCB",  // deep blue
  amber: "#e8a33d",
  danger: "#ef5350",
};

export const fonts = {
  regular: "Archivo_400Regular",
  medium: "Archivo_500Medium",
  bold: "Archivo_700Bold",
  black: "Archivo_900Black",
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
