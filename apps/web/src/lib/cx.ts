/// Class-name composition used across the web app.
///
/// `clsx` merges conditional lists; `tailwind-merge` resolves conflicting
/// utilities so a caller's `className` can override a component default.
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...parts: ClassValue[]): string {
  return twMerge(clsx(parts));
}
