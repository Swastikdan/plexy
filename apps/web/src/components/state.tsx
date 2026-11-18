import type { ReactNode } from "react";
import { Disc3 } from "lucide-react";

/// Shared empty/error state for several routes. It lives in components rather
/// than in a route file: importing a helper out of a route module pulls that
/// entire route into the importer's chunk and defeats route code splitting.
export function State({
  title,
  body,
  action,
  icon: Icon = Disc3,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: typeof Disc3;
}) {
  return (
    <div className="mx-auto flex min-h-[52vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-muted">
        <Icon size={22} strokeWidth={1.6} aria-hidden />
        <span aria-hidden className="absolute -inset-px rounded-2xl ring-1 ring-inset ring-white/[0.03]" />
      </span>
      <h2 className="font-sans text-lg font-bold tracking-[-0.03em] text-foreground">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
