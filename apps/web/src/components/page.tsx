/// Shared page frame and section heading.
///
/// Every non-player screen starts on the same gutter and uses the same
/// eyebrow → title → description rhythm. Consistency here is what makes the
/// catalog feel like one product rather than a set of routes.
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export function Page({
  children,
  className,
  width = "app",
}: {
  children: ReactNode;
  className?: string;
  width?: "app" | "reading";
}) {
  return (
    <main
      className={cx(
        width === "reading" ? "mx-auto w-full max-w-4xl px-4 sm:px-8" : "app-page",
        "min-h-dvh pb-14 pt-5 sm:pt-7",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="eyebrow mb-2 flex items-center gap-2">
            <span aria-hidden className="h-px w-5 bg-accent/70" />
            {eyebrow}
          </p>
        )}
        <h1 className="font-sans text-[1.65rem] font-extrabold leading-[1.04] tracking-[-0.04em] text-foreground sm:text-[2.15rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted sm:text-sm">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function SubHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="font-sans text-[15px] font-bold tracking-[-0.02em] text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
