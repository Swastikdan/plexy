/// Trailer Modal — plays official trailer in an embedded modal player (PRD 5.7, 10.3).
import { Dialog } from "./ui/dialog";
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
  if (!trailerKey) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[min(94vw,960px)] max-h-[90vh] p-0 overflow-hidden bg-canvas border-line">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-surface">
            <Dialog.Title className="truncate text-base font-semibold text-ink">
              {title} Trailer
            </Dialog.Title>
            <Dialog.Close className="inline-flex h-8 w-8 items-center justify-center rounded-none text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="relative aspect-video w-full bg-black">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0`}
              title={title ?? "Trailer"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
