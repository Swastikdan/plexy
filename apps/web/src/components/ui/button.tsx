/// Button component with tactile feel and visual hierarchy.
///
/// T3 Code-inspired: white is the single action color.
/// `primary` — white fill, black text (the only high-emphasis CTA)
/// `brand`   — same as primary (maps to white fill, kept for backward compat)
import { Button as BaseButton } from "@base-ui/react/button";
import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cx(...parts: ClassValue[]) {
  return twMerge(clsx(parts));
}

const styles = {
  // White fill — high-emphasis CTA; inverts cleanly on the black canvas
  primary: "bg-ink text-canvas font-semibold hover:bg-white active:bg-ink/80",
  // Same as primary — kept for backward compatibility
  brand: "bg-ink text-canvas font-semibold hover:bg-white active:bg-ink/80",
  // Dark scrim secondary (works over artwork)
  secondary: "bg-black/50 text-ink border border-white/10 hover:bg-black/65 active:bg-black/70",
  // Flat dark surface control
  surface: "bg-surface-2 text-ink border border-line hover:bg-surface-hover active:bg-surface-2",
  // Ghost — minimal; uses muted text, ink on hover
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-hover active:bg-surface-2",
  // Danger
  danger: "bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 active:bg-red-500/15",
} as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2";

export interface ButtonProps extends Omit<React.ComponentProps<typeof BaseButton>, "className" | "variant"> {
  variant?: keyof typeof styles;
  className?: string;
}

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-sm px-4 text-sm select-none",
        "transition-[background-color,border-color,color,transform] duration-100 ease-out",
        "active:scale-[0.97]",
        "disabled:opacity-35 disabled:pointer-events-none disabled:cursor-not-allowed",
        focusRing,
        styles[variant],
        className,
      )}
    />
  );
}
