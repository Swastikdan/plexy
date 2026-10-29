/// Shared page introduction.
///
/// One eyebrow/title/description rhythm keeps Search and the library pages
/// reading as the same app instead of each inventing its own heading.
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6 sm:pt-10">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            {eyebrow}
          </p>
        )}
        <h1 className={`${eyebrow ? "mt-1" : ""} font-sans text-2xl font-bold tracking-tight text-ink sm:text-3xl`}>
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}
