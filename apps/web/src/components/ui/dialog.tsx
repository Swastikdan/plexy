/// Dialog — Base UI anchored popups for the fix-match flow.
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cx } from "./button";

export const Dialog = {
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  Portal: BaseDialog.Portal,
  Close: BaseDialog.Close,
  Title: (p: React.ComponentProps<typeof BaseDialog.Title> & { className?: string }) => (
    <BaseDialog.Title {...p} className={cx("font-display text-lg font-semibold", p.className)} />
  ),
  Popup: ({ className, ...p }: React.ComponentProps<typeof BaseDialog.Popup>) => (
    <BaseDialog.Popup
      {...p}
      className={cx(
        "fixed top-1/2 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2",
        "rounded-2xl border border-line bg-surface-2 p-6 shadow-2xl shadow-black/60",
        "max-h-[85vh] overflow-y-auto",
        "outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-100",
        "transition-[opacity,transform] duration-150",
        className,
      )}
    />
  ),
  Backdrop: ({ className, ...p }: React.ComponentProps<typeof BaseDialog.Backdrop>) => (
    <BaseDialog.Backdrop
      {...p}
      className={cx(
        "fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]",
        "data-[ending-style]:opacity-0 transition-opacity duration-150",
        className,
      )}
    />
  ),
  CloseButton: ({ className, ...p }: React.ComponentProps<typeof BaseDialog.Close>) => (
    <BaseDialog.Close
      {...p}
      className={cx(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2",
        "text-ink-muted hover:text-ink hover:bg-white/5",
        className,
      )}
    />
  ),
};
