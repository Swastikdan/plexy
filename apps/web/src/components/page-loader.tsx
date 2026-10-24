import { cx } from "./ui/button";

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
      <span className="inline-flex items-center gap-3 text-sm font-medium text-ink-muted">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-brand"
          aria-hidden="true"
        />
        {label}…
      </span>
    </div>
  );
}
