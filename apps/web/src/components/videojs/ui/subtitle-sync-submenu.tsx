'use client';

import { Menu } from '@videojs/react';
import { Timer } from 'lucide-react';
import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuGlyphClass,
  menuTriggerClass,
} from '@/components/videojs/ui/menu-styles';

export interface SubtitleSyncSubmenuProps extends Omit<Menu.RootProps, 'children'> {
  offset: number;
  onAdjustOffset: (delta: number) => void;
  onResetOffset: () => void;
}

export function SubtitleSyncSubmenu({
  offset,
  onAdjustOffset,
  onResetOffset,
  ...props
}: SubtitleSyncSubmenuProps) {
  const formattedOffset =
    offset === 0 ? '0.0s' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`;

  return (
    <Menu.Root {...props}>
      <Menu.Trigger
        className={menuTriggerClass}
      >
        <Timer
          size={16}
          className={menuGlyphClass}
        />
        <span>Subtitle Sync</span>
        <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
          <span className={'max-w-24 truncate font-mono text-xs opacity-65'}>{formattedOffset}</span>
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
          <span>Subtitle Sync</span>
        </Menu.Item>
        <Menu.Separator
          className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
        />

        <div className="flex flex-col gap-2 p-2">
          <div className="text-center py-1">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Offset
            </span>
            <span className="font-mono text-base font-bold text-white">
              {formattedOffset}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustOffset(-0.5);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              -0.5s
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustOffset(0.5);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              +0.5s
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustOffset(-0.1);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              -0.1s
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdjustOffset(0.1);
              }}
              className="flex items-center justify-center rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition"
            >
              +0.1s
            </button>
          </div>

          <button
            type="button"
            disabled={offset === 0}
            onClick={(e) => {
              e.stopPropagation();
              onResetOffset();
            }}
            className="mt-1 flex items-center justify-center rounded-lg bg-white/5 px-2 py-1.5 text-xs font-medium text-white/70 hover:bg-white/15 disabled:opacity-30 disabled:pointer-events-none transition"
          >
            Reset (0.0s)
          </button>
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}
