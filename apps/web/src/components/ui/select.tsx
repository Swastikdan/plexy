/// Select — Base UI wrapped with Plexy's look: flat surface, blue item
/// highlight, check state carried by CSS variables Base UI sets.
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
        "inline-flex h-9 min-w-44 items-center justify-between gap-2 rounded-lg",
        "border border-line bg-surface-2 px-3 text-sm text-ink",
        "hover:border-line-strong transition-colors",
        "focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2",
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
          "max-h-[min(18rem,var(--available-height))] overflow-y-auto rounded-xl border border-line",
          "bg-surface-2 p-1",
          "outline-none data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity duration-100",
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
        "flex min-h-8 cursor-default select-none items-center justify-between gap-4 rounded-lg px-3 text-sm",
        "data-[highlighted]:bg-brand/10 data-[highlighted]:text-ink",
        "data-[selected]:text-brand-text",
        className,
      )}
    >
      {p.children}
      <BaseSelect.ItemIndicator className="text-brand-text">
        <Check size={14} aria-hidden />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  ),
  ItemText: BaseSelect.ItemText,
};
