'use client';

import { Menu } from '@videojs/react';
import { ListVideo } from 'lucide-react';

import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuGlyphClass,
  menuTriggerClass,
} from '@/components/videojs/ui/menu-styles';

export interface Chapter {
  start: number;
  end: number;
  label: string;
}

function timeLabel(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function ChaptersMenu({
  chapters,
  onSelect,
}: {
  chapters: Chapter[];
  onSelect: (start: number) => void;
}) {
  if (chapters.length < 2) return null;
  return (
    <Menu.Root>
      <Menu.Trigger className={menuTriggerClass}>
        <ListVideo size={16} className={menuGlyphClass} />
        <span>Chapters</span>
        <span className="ms-auto inline-flex min-w-0 items-center gap-1 ps-2">
          <span className="max-w-24 truncate font-mono text-xs opacity-65">
            {chapters.length}
          </span>
          <MenuChevron />
        </span>
      </Menu.Trigger>
      <Menu.Content className={menuContentClass}>
        <Menu.Item className={menuBackItemClass}>
          <MenuChevron back />
          <span>Chapters</span>
        </Menu.Item>
        <Menu.Separator className="my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25" />
        <div className="flex max-h-72 flex-col gap-0.5 overflow-auto">
          {chapters.map((chapter, index) => (
            <button
              key={`${chapter.start}-${index}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(chapter.start);
              }}
              className="flex items-center justify-between gap-3 rounded-media-menu-item px-2 py-1.5 text-start text-xs transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            >
              <span className="truncate">{chapter.label || `Chapter ${index + 1}`}</span>
              <span className="shrink-0 font-mono text-[10px] opacity-60">
                {timeLabel(chapter.start)}
              </span>
            </button>
          ))}
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}
