'use client';

import { Menu } from '@videojs/react';
import { Layers } from 'lucide-react';

import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuGlyphClass,
  menuTriggerClass,
} from '@/components/videojs/ui/menu-styles';
import type { Playability } from '@plexy/api-client';

type Version = NonNullable<Playability['versions']>[number];

export function VersionsMenu({
  versions,
  selectedFileId,
  onSelect,
}: {
  versions: Version[];
  selectedFileId: number;
  onSelect: (fileId: number) => void;
}) {
  if (versions.length < 2) return null;
  const current = versions.find((version) => version.fileId === selectedFileId);
  return (
    <Menu.Root>
      <Menu.Trigger className={menuTriggerClass}>
        <Layers size={16} className={menuGlyphClass} />
        <span>Version</span>
        <span className="ms-auto inline-flex min-w-0 items-center gap-1 ps-2">
          <span className="max-w-24 truncate opacity-65">
            {current?.label ?? `${versions.length} versions`}
          </span>
          <MenuChevron />
        </span>
      </Menu.Trigger>
      <Menu.Content className={menuContentClass}>
        <Menu.Item className={menuBackItemClass}>
          <MenuChevron back />
          <span>Version</span>
        </Menu.Item>
        <Menu.Separator className="my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25" />
        <div className="flex flex-col gap-0.5">
          {versions.map((version) => {
            const selected = version.fileId === selectedFileId;
            return (
              <button
                key={version.fileId}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!selected) onSelect(version.fileId);
                }}
                className="flex items-center justify-between gap-3 rounded-media-menu-item px-2 py-1.5 text-start text-xs transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              >
                <span className="truncate">{version.label}</span>
                <span className="shrink-0 text-[10px] opacity-60">
                  {(version.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                </span>
                {selected && <span className="shrink-0 text-[10px] opacity-80">Current</span>}
              </button>
            );
          })}
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}
