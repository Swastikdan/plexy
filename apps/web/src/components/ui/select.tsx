/// Select — Base UI wrapped with Plexy's look: flat surface, amber item
/// highlight, check state carried by CSS variables Base UI sets.
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
        "hover:border-amber/50 transition-colors",
        className,
      )}
    >
      {children}
    </BaseSelect.Trigger>
  ),
  Icon: BaseSelect.Icon,
  Positioner: ({ sideOffset = 6, ...p }: React.ComponentProps<typeof BaseSelect.Positioner>) => (
    <BaseSelect.Positioner {...p} sideOffset={sideOffset} className="z-50 outline-none">
      <BaseSelect.Popup
        className={cx(
          "max-h-72 min-w-[var(--available-width)] overflow-y-auto rounded-xl border border-line",
          "bg-surface-2 p-1 shadow-xl shadow-black/50",
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
        "data-[highlighted]:bg-amber/15 data-[highlighted]:text-ink",
        "data-[selected]:text-amber",
        className,
      )}
    >
      {p.children}
      <BaseSelect.ItemIndicator className="text-amber">✓</BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  ),
  ItemText: BaseSelect.ItemText,
};
