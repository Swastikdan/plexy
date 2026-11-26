/// Confirmation dialog for destructive actions.
///
/// Replaces `window.confirm` with HeroUI's AlertDialog so the prompt matches
/// the app's overlay styling. The caller owns the pending action: pass a
/// callback that runs only after the viewer confirms.
import { AlertDialog, Button } from "@heroui/react";

export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Backdrop variant="blur">
        <AlertDialog.Container placement="center" size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            {body && <AlertDialog.Body>{body}</AlertDialog.Body>}
            <AlertDialog.Footer>
              <Button variant="secondary" onPress={() => onOpenChange(false)}>
                {cancelLabel}
              </Button>
              <Button
                variant="danger"
                onPress={() => {
                  onOpenChange(false);
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
