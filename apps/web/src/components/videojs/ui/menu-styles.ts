/// Shared chrome for the in-player settings menus.
///
/// Every submenu in this folder renders the same trigger row, slide-in content
/// panel, back item, and radio-group header. Keeping the class lists here means
/// a spacing or focus-ring change lands in one place instead of eight.
export const menuTriggerClass = [
  "group/menu-trigger-item",
  "relative flex cursor-pointer select-none items-center gap-1.5 rounded-media-menu-item px-2 py-1.5 text-start whitespace-nowrap",
  "focus-ring-media",
  "media-highlighted:highlight-media",
  "focus-visible:outline-media-ring focus-visible:outline-offset-2",
  "text-shadow-media",
  "transition-[background-color,color] duration-media-fast ease-in-out",
  "media-anchored:duration-media-instant media-anchored:media-highlighted:duration-media-slow",
  "justify-between tabular-nums text-inherit",
  "aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
  "media-anchored:data-highlighted:[anchor-name:--media-menu-item-highlight-anchor]",
  "media-anchored:media-highlighted:bg-transparent",
].join(" ");

/// Captions, playback rate, and quality hide themselves when the media reports
/// the track as unavailable. The subtitle-position and -sync items have no
/// availability state, so they use the variant without those selectors.
export const menuTriggerClassWithAvailability = [
  menuTriggerClass,
  "data-[availability=unavailable]:hidden data-[availability=unsupported]:hidden",
].join(" ");

export const menuContentClass = [
  "[anchor-scope:--media-menu-item-highlight-anchor]",
  "media-anchored:before:anchor-media-highlight",
  "media-transitioning:before:hidden",
  "media-transitioning:[&_*]:before:hidden",
  "media-anchored:has-data-[highlighted=]:before:duration-0",
  "not-data-submenu:flex not-data-submenu:flex-col not-data-submenu:gap-0.5",
  "not-data-submenu:data-child-open:blur-media-hidden",
  "not-data-submenu:data-child-open:before:hidden",
  "data-submenu:media-transitioning:pointer-events-none data-submenu:media-transitioning:overflow-hidden",
  "data-submenu:media-transitioning:blur-media-hidden",
  "absolute max-h-[inherit] overflow-auto overscroll-none outline-hidden",
  "transition-[translate,filter] duration-media-menu ease-out",
  "not-data-submenu:inset-x-1 not-data-submenu:top-1",
  "not-data-submenu:data-child-open:-translate-x-full",
  "not-data-submenu:data-child-open:rtl:translate-x-full",
  "data-submenu:inset-x-0 data-submenu:top-0 data-submenu:z-10 data-submenu:max-h-[inherit] data-submenu:p-1",
  "data-submenu:media-transitioning:translate-x-full data-submenu:media-transitioning:rtl:-translate-x-full",
].join(" ");

export const menuBackItemClass = [
  "group/menu-back-item",
  "relative flex cursor-pointer select-none items-center gap-1.5 rounded-media-menu-item px-2 py-1.5 text-start whitespace-nowrap",
  "focus-ring-media",
  "media-highlighted:highlight-media",
  "focus-visible:outline-media-ring focus-visible:outline-offset-2",
  "text-shadow-media",
  "transition-[background-color,color] duration-media-fast ease-in-out",
  "media-anchored:duration-media-instant media-anchored:media-highlighted:duration-media-slow",
  "mb-0.5 w-full",
].join(" ");

/// Lucide icons take their size from the `size` prop instead.
export const menuGlyphClass = [
  "shrink-0 drop-shadow-media-icon text-media-muted-foreground",
  "group-media-highlighted/menu-trigger-item:text-inherit",
].join(" ");

export const menuIconClass = [menuGlyphClass, "size-media-icon"].join(" ");

/// Shared chrome for anchored popovers (tooltip, volume, settings). The
/// enter/exit transform, side origin, and tap-through bridge are identical;
/// callers append their own layout.
export const popoverChromeClass = [
  "m-0 overflow-visible border-0 text-inherit",
  "media-transitioning:opacity-0 media-transitioning:blur-media-hidden-popup media-transitioning:scale-media-hidden-popup",
  "data-starting-style:transform-[translate(var(--media-popup-translate-x-distance,0),var(--media-popup-translate-y-distance,0))]",
  "data-ending-style:transform-none",
  "data-[side=top]:origin-bottom data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left",
  "data-[side=top]:[--media-popup-translate-y-distance:var(--media-popup-translate-distance)]",
  "data-[side=bottom]:[--media-popup-translate-y-distance:calc(var(--media-popup-translate-distance)*-1)]",
  "data-[side=left]:[--media-popup-translate-x-distance:var(--media-popup-translate-distance)]",
  "data-[side=right]:[--media-popup-translate-x-distance:calc(var(--media-popup-translate-distance)*-1)]",
  "data-starting-style:filter-none",
].join(" ");

/// The popover panel paint, shared by the same three surfaces.
export const popoverSurfaceClass = [
  "bg-media-popover text-media-popover-foreground surface-media after:surface-media-inset",
  "after:hidden",
].join(" ");

/// Extension of the popover chrome for tooltips and the volume panel: the
/// transparent strip keeps the pointer from closing the panel while crossing
/// the gap between trigger and popup.
export const popoverBridgeClass = [
  "before:pointer-events-auto before:absolute",
  "data-[side=top]:before:inset-x-0 data-[side=top]:before:top-full",
  "data-[side=bottom]:before:inset-x-0 data-[side=bottom]:before:bottom-full",
  "data-[side=left]:before:inset-y-0 data-[side=left]:before:left-full",
  "data-[side=right]:before:inset-y-0 data-[side=right]:before:right-full",
  "data-[side=top]:before:h-(--media-popup-side-offset) data-[side=bottom]:before:h-(--media-popup-side-offset)",
  "data-[side=left]:before:w-(--media-popup-side-offset) data-[side=right]:before:w-(--media-popup-side-offset)",
  "transition-media-popup data-ending-style:duration-media-instant",
].join(" ");

export const menuOptionsClass = [
  "flex [max-height:inherit] flex-col gap-0.5",
  "[anchor-scope:--media-menu-item-highlight-anchor]",
  "media-anchored:before:anchor-media-highlight",
  "media-transitioning:before:hidden",
  "media-transitioning:[&_*]:before:hidden",
  "media-anchored:has-data-[highlighted=]:before:duration-0",
].join(" ");
