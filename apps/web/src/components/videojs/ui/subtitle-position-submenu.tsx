'use client';

import { Menu } from '@videojs/react';
import { ChevronsUpDown } from 'lucide-react';
import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuGlyphClass,
  menuTriggerClass,
} from '@/components/videojs/ui/menu-styles';

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
        className={menuTriggerClass}
      >
        <ChevronsUpDown
          size={16}
          className={menuGlyphClass}
        />
        <span>Subtitle Position</span>
        <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
          <span className={'max-w-24 truncate font-mono text-xs opacity-65'}>{formattedPosition}</span>
          <MenuChevron />
        </span>
      </Menu.Trigger>

      <Menu.Content
        className={menuContentClass}
      >
        <Menu.Item
          className={menuBackItemClass}
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
