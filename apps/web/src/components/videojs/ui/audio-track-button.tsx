'use client';

import { Menu } from '@videojs/react';
import { AudioLines } from 'lucide-react';

import { Button } from '@/components/videojs/ui/button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { RadioItem } from '@/components/videojs/ui/radio-item';
import { cn, resolveClassName } from '@/lib/resolve-class-name';
import type { ServerAudioTrack } from './audio-track-menu';

export interface AudioTrackButtonProps {
  tracks?: ServerAudioTrack[];
  selectedIndex?: number;
  onSelectTrack?: (index: number) => void;
  className?: string;
}

function formatLanguage(code?: string): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function AudioTrackButton({
  tracks,
  selectedIndex = 0,
  onSelectTrack,
  className,
}: AudioTrackButtonProps) {
  if (!tracks || tracks.length === 0) return null;

  const trackLabel = (t: ServerAudioTrack) => {
    const lang = formatLanguage(t.language);
    const label = lang || `Track ${t.index + 1}`;
    const details = [t.codec?.toUpperCase(), t.channels ? `${t.channels}ch` : ''].filter(Boolean).join(' ');
    return details ? `${label} (${details})` : label;
  };

  return (
    <Menu.Root side="top" align="center">
      <ButtonTooltip label="Audio Tracks" side="top">
        <Menu.Trigger
          render={<Button />}
          className={(state) => cn('group/audio relative', resolveClassName(className, state))}
          aria-label="Select audio track"
        >
          <AudioLines
            className={cn(
              'col-start-1 row-start-1 size-media-icon drop-shadow-media-icon [text-shadow:inherit]',
              'transition-[opacity,scale] duration-media-base ease-out text-white'
            )}
          />
        </Menu.Trigger>
      </ButtonTooltip>
      <Menu.Popup
        keepMounted
        className={cn(
          'm-0 overflow-visible border-0 text-inherit',
          'media-transitioning:opacity-0 media-transitioning:blur-media-hidden-popup media-transitioning:scale-media-hidden-popup',
          'data-starting-style:transform-[translate(var(--media-popup-translate-x-distance,0),var(--media-popup-translate-y-distance,0))]',
          'data-ending-style:transform-none',
          'data-[side=top]:origin-bottom data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left',
          'data-[side=top]:[--media-popup-translate-y-distance:var(--media-popup-translate-distance)]',
          'data-[side=bottom]:[--media-popup-translate-y-distance:calc(var(--media-popup-translate-distance)*-1)]',
          'data-[side=left]:[--media-popup-translate-x-distance:var(--media-popup-translate-distance)]',
          'data-[side=right]:[--media-popup-translate-x-distance:calc(var(--media-popup-translate-distance)*-1)]',
          'data-starting-style:filter-none',
          'bg-media-popover text-media-popover-foreground surface-media after:surface-media-inset',
          'after:hidden',
          'm-0 min-w-44 max-w-(--media-menu-available-width) overflow-hidden! rounded-media-popup border-0 p-1 [--media-popup-side-offset:var(--media-popover-side-offset)]',
          'max-h-[min(var(--media-menu-available-height,--spacing(56)),--spacing(56))] overscroll-none',
          'h-(--media-menu-height) w-(--media-menu-width)',
          'transition-media-popup media-transitioning:transition-media-popup',
          'transition-media-menu-resize'
        )}
      >
        <Menu.Content
          className={cn(
            'flex flex-col gap-0.5',
            'absolute inset-x-1 top-1 max-h-[inherit] overflow-auto overscroll-none outline-hidden'
          )}
        >
          <div className="px-2 py-1 text-xs font-semibold text-media-muted-foreground uppercase tracking-wider">
            Audio Tracks
          </div>
          <Menu.RadioGroup
            value={String(selectedIndex)}
            onValueChange={(val) => {
              if (val !== undefined && val !== null) {
                onSelectTrack?.(Number(val));
              }
            }}
          >
            {tracks.map((track) => (
              <RadioItem key={track.index} value={String(track.index)}>
                <span>{trackLabel(track)}</span>
              </RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Popup>
    </Menu.Root>
  );
}
