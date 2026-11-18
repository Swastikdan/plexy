/// Shared building blocks for the personal settings panels.
///
/// One header, one body inset, one hairline set: every panel in Settings reads
/// as part of the same control room rather than a stack of unrelated cards.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../../lib/cx";

export function SettingsSection({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  return (
    <section className={cx("panel overflow-hidden", className)}>
      <header className={cx("flex flex-wrap items-start justify-between gap-4 px-4 py-3.5 sm:px-5 sm:py-4", !flush && children !== undefined && "border-b border-border/70")}>
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-secondary text-muted">
              <Icon size={15} strokeWidth={1.8} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[12.5px] font-bold tracking-[-0.01em] text-foreground">{title}</h2>
            {description && (
              <p className="mt-0.5 max-w-2xl text-[10.5px] leading-relaxed text-muted sm:text-[11px]">{description}</p>
            )}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      {children !== undefined && (
        <div className={cx(flush ? "" : "p-4 sm:p-5", bodyClassName)}>{children}</div>
      )}
    </section>
  );
}

export function SettingsToggleRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[11.5px] font-semibold text-foreground">{label}</p>
        {description && <p className="mt-0.5 max-w-xl text-[10.5px] leading-relaxed text-muted">{description}</p>}
      </div>
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
