/// Select — Base UI wrapped with Plexy's look: flat surface, monochrome item highlight.
import { ChevronDown, Check } from "lucide-react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { cx } from "./button";

export const Select = {
  Root: BaseSelect.Root,
  Value: BaseSelect.Value,
  Trigger: ({ className, children, ...p }: React.ComponentProps<typeof BaseSelect.Trigger>) => (
    <BaseSelect.Trigger
      {...p}
      className={cx(
        "inline-flex h-9 min-w-44 items-center justify-between gap-2 rounded-sm",
        "border border-line bg-surface-2 px-3 text-sm text-ink",
        "hover:border-line-strong transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2",
        className,
      )}
    >
      {children}
    </BaseSelect.Trigger>
  ),
  Icon: ({
    className,
    ...p
  }: React.ComponentProps<typeof BaseSelect.Icon>) => (
    <BaseSelect.Icon {...p} className={cx("text-ink-muted", className)}>
      <ChevronDown size={15} aria-hidden />
    </BaseSelect.Icon>
  ),
  Positioner: ({ sideOffset = 6, ...p }: React.ComponentProps<typeof BaseSelect.Positioner>) => (
    <BaseSelect.Positioner {...p} sideOffset={sideOffset} className="z-50 outline-none">
      <BaseSelect.Popup
        className={cx(
          "w-max min-w-[min(var(--anchor-width),20rem,var(--available-width))] max-w-[min(20rem,var(--available-width))]",
          "max-h-[min(18rem,var(--available-height))] overflow-y-auto border border-line",
          "bg-surface-2 p-1",
          "outline-none",
          // Smooth scale+fade on open/close
          "transition-[opacity,transform,scale] duration-[150ms] ease-out origin-top",
          "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:-translate-y-0.5",
          "data-[ending-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:-translate-y-0.5",
        )}
      >
        {p.children}
      </BaseSelect.Popup>
    </BaseSelect.Positioner>
  ),
  Item: ({ className, ...p }: React.ComponentProps<typeof BaseSelect.Item>) => (
    <BaseSelect.Item
      {...p}
      className={cx(
        "flex min-h-8 cursor-default select-none items-center justify-between gap-4 px-3 text-sm",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-ink",
        "data-[selected]:text-ink",
        "transition-colors duration-100",
        className,
      )}
    >
      {p.children}
      <BaseSelect.ItemIndicator className="text-ink-muted">
        <Check size={14} aria-hidden />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  ),
  ItemText: BaseSelect.ItemText,
};
