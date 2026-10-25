'use client';

import { Menu } from '@videojs/react';
import { ChevronsUpDown } from 'lucide-react';
import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import { cn } from '@/lib/resolve-class-name';

export interface SubtitlePositionSubmenuProps extends Omit<Menu.RootProps, 'children'> {
  /** Vertical offset in pixels. Positive values lift subtitles up the frame. */
  position: number;
  onAdjustPosition: (delta: number) => void;
  onResetPosition: () => void;
}

export function SubtitlePositionSubmenu({
  position,
  onAdjustPosition,
  onResetPosition,
  ...props
}: SubtitlePositionSubmenuProps) {
  const formattedPosition =
    position === 0 ? 'Default' : `${position > 0 ? '+' : ''}${Math.round(position)}px`;

  return (
    <Menu.Root {...props}>
      <Menu.Trigger
        className={cn(
          'group/menu-trigger-item',
          'relative flex cursor-pointer select-none items-center gap-1.5 rounded-media-menu-item px-2 py-1.5 text-start whitespace-nowrap',
          'focus-ring-media',
          'media-highlighted:highlight-media',
          'focus-visible:outline-media-ring focus-visible:outline-offset-2',
          'text-shadow-media',
          'transition-[background-color,color] duration-media-fast ease-in-out',
          'media-anchored:duration-media-instant media-anchored:media-highlighted:duration-media-slow',
          'justify-between tabular-nums text-inherit',
          'aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
          'media-anchored:data-highlighted:[anchor-name:--media-menu-item-highlight-anchor]',
          'media-anchored:media-highlighted:bg-transparent'
        )}
      >
        <ChevronsUpDown
          size={16}
          className={cn(
            'shrink-0 drop-shadow-media-icon text-media-muted-foreground',
            'group-media-highlighted/menu-trigger-item:text-inherit'
          )}
        />
        <span>Subtitle Position</span>
        <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
          <span className={'max-w-24 truncate font-mono text-xs opacity-65'}>{formattedPosition}</span>
          <MenuChevron />
        </span>
      </Menu.Trigger>

      <Menu.Content
        className={cn(
          '[anchor-scope:--media-menu-item-highlight-anchor]',
          'media-anchored:before:anchor-media-highlight',
          'media-transitioning:before:hidden',
          'media-transitioning:[&_*]:before:hidden',
          'media-anchored:has-data-[highlighted=]:before:duration-0',
          'not-data-submenu:flex not-data-submenu:flex-col not-data-submenu:gap-0.5',
          'not-data-submenu:data-child-open:blur-media-hidden',
          'not-data-submenu:data-child-open:before:hidden',
          'data-submenu:media-transitioning:pointer-events-none data-submenu:media-transitioning:overflow-hidden',
          'data-submenu:media-transitioning:blur-media-hidden',
          'absolute max-h-[inherit] overflow-auto overscroll-none outline-hidden',
          'transition-[translate,filter] duration-media-menu ease-out',
          'not-data-submenu:inset-x-1 not-data-submenu:top-1',
          'not-data-submenu:data-child-open:-translate-x-full',
          'not-data-submenu:data-child-open:rtl:translate-x-full',
          'data-submenu:inset-x-0 data-submenu:top-0 data-submenu:z-10 data-submenu:max-h-[inherit] data-submenu:p-1',
          'data-submenu:media-transitioning:translate-x-full data-submenu:media-transitioning:rtl:-translate-x-full'
        )}
      >
        <Menu.Item
          className={cn(
            'group/menu-back-item',
            'relative flex cursor-pointer select-none items-center gap-1.5 rounded-media-menu-item px-2 py-1.5 text-start whitespace-nowrap',
            'focus-ring-media',
            'media-highlighted:highlight-media',
            'focus-visible:outline-media-ring focus-visible:outline-offset-2',
            'text-shadow-media',
            'transition-[background-color,color] duration-media-fast ease-in-out',
            'media-anchored:duration-media-instant media-anchored:media-highlighted:duration-media-slow',
            'mb-0.5 w-full'
          )}
        >
          <MenuChevron back />
          <span>Subtitle Position</span>
        </Menu.Item>
        <Menu.Separator
          className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
        />

        <div className="flex flex-col gap-2 p-2">
          <div className="text-center py-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Vertical offset
            </span>
            <span className="font-mono text-base font-bold text-white">
              {formattedPosition}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustPosition(-40);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              −40px
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustPosition(40);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              +40px
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustPosition(-20);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              −20px
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustPosition(20);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              +20px
            </button>
          </div>

          <button
            type="button"
            disabled={position === 0}
            onClick={(e) => {
              e.stopPropagation();
              onResetPosition();
            }}
            className="mt-1 flex items-center justify-center rounded-lg bg-white/5 px-2 py-1.5 text-xs font-medium text-white/70 hover:bg-white/15 disabled:opacity-30 disabled:pointer-events-none transition"
          >
            Reset to default
          </button>
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}
