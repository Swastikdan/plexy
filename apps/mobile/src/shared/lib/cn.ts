// Join conditional Tailwind class names. Mirror of clsx's API for the
// subset the app uses (strings, false/undefined/null, arrays, objects).
export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

export function cn(...values: ClassValue[]): string {
  let out = "";
  const walk = (value: ClassValue) => {
    if (!value && value !== 0 && value !== "") return;
    if (typeof value === "string" || typeof value === "number") {
      out += (out ? " " : "") + value;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      for (const [key, on] of Object.entries(value)) if (on) walk(key);
    }
  };
  values.forEach(walk);
  return out;
}
