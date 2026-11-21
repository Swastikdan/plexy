/// Shared building blocks for the personal settings panels.
///
/// One header, one body inset, one hairline set: every panel in Settings reads
/// as part of the same control room rather than a stack of unrelated cards.
import { Children, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "@/lib/cx";

export function SettingsSection({
  title,
  icon: Icon,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  const hasBody = Children.toArray(children).length > 0;
  return (
    <section className={cx("panel overflow-hidden", className)}>
      <header className={cx("flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5", !flush && hasBody && "border-b border-border/70")}>
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-secondary text-muted">
              <Icon size={15} strokeWidth={1.8} aria-hidden />
            </span>
          )}
          <h2 className="text-[12.5px] font-bold tracking-[-0.01em] text-foreground">{title}</h2>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      {hasBody && (
        <div className={cx(flush ? "" : "p-4 sm:p-5", bodyClassName)}>{children}</div>
      )}
    </section>
  );
}

export function SettingsToggleRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-3.5 first:pt-0 last:pb-0">
      <p className="min-w-0 text-[11.5px] font-semibold text-foreground">{label}</p>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10.5px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}
