/// Profile identity mark used in the header, settings dashboard, and user
/// roster. Renders the uploaded photo when there is one, and falls back to the
/// account's initial so every surface has the same calm, consistent shape.
import { useState } from "react";
import { cx } from "../lib/cx";

export function UserAvatar({
  user,
  size = 32,
  className,
}: {
  user?: { username: string; avatar?: string | null } | null;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const src = user?.avatar ?? null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const initial = user?.username?.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-secondary font-sans font-bold uppercase text-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}
