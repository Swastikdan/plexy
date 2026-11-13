/// Trailer Modal — plays an official trailer in an embedded modal player (PRD 5.7, 10.3).
import { Modal } from "@heroui/react";
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
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[min(94vw,960px)] max-w-none overflow-hidden p-0">
            <Modal.Header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
              <Modal.Heading className="truncate text-base font-semibold">
                {title} Trailer
              </Modal.Heading>
              <Modal.CloseTrigger className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-tertiary hover:text-foreground">
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <div className="relative aspect-video w-full bg-black">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0`}
                title={title ?? "Trailer"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
