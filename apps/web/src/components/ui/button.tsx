/// Button component with Netflix-grade tactile feel and visual hierarchy.
import { Button as BaseButton } from "@base-ui/react/button";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}

const styles = {
  // Netflix-style bold white play button
  primary: "bg-white text-black font-semibold hover:bg-white/90 shadow-sm active:bg-white/80",
  // Netflix-style brand red CTA
  brand: "bg-[#E50914] text-white font-semibold hover:bg-[#F40612] active:bg-[#B80710] shadow-sm",
  // Translucent glass secondary (More info / secondary actions)
  secondary: "bg-white/15 text-white backdrop-blur-md border border-white/10 hover:bg-white/25 active:bg-white/20",
  // Dark surface (cards, admin controls)
  surface: "bg-surface-2 text-ink border border-line hover:bg-surface-hover active:bg-surface-2",
  // Amber action (server settings / highlights)
  amber: "bg-amber text-black font-medium hover:bg-amber-soft active:bg-amber",
  // Minimal ghost
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-white/10 active:bg-white/5",
  // Danger destructive
  danger: "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 active:bg-red-500/15",
} as const;

export interface ButtonProps extends Omit<React.ComponentProps<typeof BaseButton>, "className" | "variant"> {
  variant?: keyof typeof styles;
  className?: string;
}

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm select-none",
        "transition-all duration-150 ease-out",
        "active:scale-[0.97]",
        "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed",
        styles[variant],
        className,
      )}
    />
  );
}
