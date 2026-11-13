import type { ReactNode } from "react";

/// Shared empty/error state for several routes. It lives in components rather
/// than in a route file: importing a helper out of a route module pulls that
/// entire route into the importer's chunk and defeats route code splitting.
export function State({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <h2 className="font-sans text-xl font-bold text-foreground">{title}</h2>
      <p className="text-sm text-muted leading-relaxed">{body}</p>
      {action}
    </div>
  );
}
