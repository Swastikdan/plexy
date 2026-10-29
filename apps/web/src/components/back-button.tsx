/// The one back affordance used everywhere: a quiet icon button that matches
/// the app header. Chrome-less screens (connection, setup) reuse it so going
/// back never looks like a different control.
import { ArrowLeft } from "lucide-react";
import { cx } from "./ui/button";

export function BackButton({
  onClick,
  className,
  label = "Go back",
}: {
  onClick: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="Back"
      className={cx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center text-ink-muted transition-all",
        "hover:text-ink active:scale-95",
        "focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2",
        className,
      )}
    >
      <ArrowLeft size={18} />
    </button>
  );
}
