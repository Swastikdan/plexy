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
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-6 pt-4 sm:pt-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[0.6875rem] font-semibold tracking-[0.01em] leading-[1.25] text-muted mb-2 flex items-center gap-2">
            <span aria-hidden className="h-px w-5 bg-accent/70" />
            {eyebrow}
          </p>
        )}
        <h1 className="font-sans text-[1.7rem] font-extrabold leading-[1.03] tracking-[-0.04em] text-foreground sm:text-[2.3rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted sm:text-sm">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
