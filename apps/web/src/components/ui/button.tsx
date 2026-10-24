/// Button component with tactile feel and visual hierarchy.
///
/// Variants read from theme tokens so dark and light modes stay consistent:
/// `primary` inverts with the canvas, `brand` is the single blue accent.
import { Button as BaseButton } from "@base-ui/react/button";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}

const styles = {
  // Bold ink play button; inverts automatically in light mode
  primary: "bg-ink text-canvas font-semibold hover:bg-ink/90 active:bg-ink/80",
  // Single blue accent CTA
  brand: "bg-brand text-white font-semibold hover:bg-brand-hover active:bg-brand-active",
  // Translucent dark scrim secondary (works over artwork in both themes)
  secondary: "bg-black/40 text-ink border border-white/10 hover:bg-black/55 active:bg-black/60",
  // Dark surface (cards, admin controls)
  surface: "bg-surface-2 text-ink border border-line hover:bg-surface-hover active:bg-surface-2",
  // Minimal ghost
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-hover active:bg-surface-2",
  // Danger destructive
  danger: "bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20 active:bg-red-500/15",
} as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2";

export interface ButtonProps extends Omit<React.ComponentProps<typeof BaseButton>, "className" | "variant"> {
  variant?: keyof typeof styles;
  className?: string;
}

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm select-none",
        "transition-[background-color,border-color,color,transform] duration-150 ease-out",
        "active:scale-[0.97]",
        "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed",
        focusRing,
        styles[variant],
        className,
      )}
    />
  );
}
