import { cx } from "../lib/cx";

/// A quiet, branded status line. The ring uses the brand cobalt and the
/// label stays small; long lists get skeleton rows elsewhere.
export function PageLoader({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx("flex min-h-[55vh] items-center justify-center", className)}
    >
      <span className="inline-flex items-center gap-3 text-[13px] font-medium text-muted">
        <span aria-hidden className="relative flex h-5 w-5 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-border" />
          <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-accent" />
        </span>
        {label}…
      </span>
    </div>
  );
}
