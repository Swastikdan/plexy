/// Trailer player — a full-window YouTube surface with one close control.
///
/// The embed fills the viewport instead of sitting in a framed dialog, so the
/// trailer is the only thing on screen. YouTube needs a referrer to validate
/// the embed; the server sends `Referrer-Policy: no-referrer`, so the iframe
/// overrides it explicitly and passes `origin` to the player.
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function TrailerModal({
  open,
  onOpenChange,
  trailerKey,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trailerKey: string | null;
  title?: string;
}) {
  const surface = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || !trailerKey) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);

    // Fullscreen is best-effort: the overlay already covers the app window if
    // the browser refuses the request (or the player itself blocks it).
    const element = surface.current;
    void element?.requestFullscreen?.().catch(() => {});
    element?.focus();

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
      if (document.fullscreenElement === element) {
        void document.exitFullscreen().catch(() => {});
      }
      previous?.focus();
    };
  }, [close, open, trailerKey]);

  if (!open || !trailerKey) return null;

  const origin = typeof window === "undefined" ? "" : encodeURIComponent(window.location.origin);
  const src = `https://www.youtube.com/embed/${encodeURIComponent(trailerKey)}?autoplay=1&rel=0&playsinline=1&modestbranding=1&fs=1&origin=${origin}`;

  return createPortal(
    <div
      ref={surface}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} trailer` : "Trailer"}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black outline-none"
    >
      <iframe
        src={src}
        title={title ? `${title} trailer` : "Trailer"}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        className="h-full w-full border-0"
      />
      <button
        type="button"
        onClick={close}
        aria-label="Close trailer"
        title="Close trailer"
        className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-md transition-[background-color,transform] duration-150 hover:bg-black/80 active:scale-95"
      >
        <X size={22} />
      </button>
    </div>,
    document.body,
  );
}
