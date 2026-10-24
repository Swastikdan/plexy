/// Dropdown Menu — Base UI wrapped with Plexy design tokens.
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cx } from "./button";

export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Portal: BaseMenu.Portal,
  Positioner: ({ sideOffset = 6, className, ...p }: React.ComponentProps<typeof BaseMenu.Positioner>) => (
    <BaseMenu.Portal>
      <BaseMenu.Positioner {...p} sideOffset={sideOffset} className={cx("z-50 outline-none", className)}>
        <BaseMenu.Popup
          className={cx(
            "min-w-44 rounded-xl border border-line bg-surface-2 p-1 text-ink shadow-2xl backdrop-blur-md",
            "outline-none",
            // Smooth scale+fade on open/close — no jump
            "transition-[opacity,transform,scale] duration-[150ms] ease-out origin-top",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:-translate-y-0.5",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:-translate-y-0.5",
          )}
        >
          {p.children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  ),
  Item: ({ className, ...p }: React.ComponentProps<typeof BaseMenu.Item>) => (
    <BaseMenu.Item
      {...p}
      className={cx(
        "flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink",
        "data-[highlighted]:bg-brand/10 data-[highlighted]:text-brand-text focus:outline-none transition-colors duration-100",
        className,
      )}
    >
      {p.children}
    </BaseMenu.Item>
  ),
  Separator: ({ className, ...p }: React.ComponentProps<typeof BaseMenu.Separator>) => (
    <BaseMenu.Separator
      {...p}
      className={cx("my-1 h-px bg-line/60", className)}
    />
  ),
};
