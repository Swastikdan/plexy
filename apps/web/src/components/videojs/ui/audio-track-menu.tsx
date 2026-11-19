'use client';

import { audioText } from '@videojs/core/i18n/text/menu';
import { Menu } from '@videojs/react';
import { Text as TextPrimitive } from '@videojs/react';
import { SpeechIcon as SpeechIconPrimitive } from '@videojs/react/icons/neutral';
import { AudioTrackRadioGroup } from '@videojs/react/ui/audio-track-radio-group';

import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuIconClass,
  menuOptionsClass,
  menuTriggerClass,
  menuTriggerClassWithAvailability,
} from '@/components/videojs/ui/menu-styles';
import { RadioItem } from '@/components/videojs/ui/radio-item';
import { languageName } from '@/lib/language';

export interface ServerAudioTrack {
  index: number;
  codec: string;
  channels: number;
  language: string;
  isDefault?: boolean;
  /** False when picking this language needs a short one-time remux first. */
  prepared?: boolean;
}

export interface AudioTrackMenuProps extends Omit<Menu.RootProps, 'children'> {
  serverTracks?: ServerAudioTrack[];
  selectedServerTrackIndex?: number;
  onSelectServerTrack?: (index: number) => void;
}

function formatLanguage(code?: string): string {
  if (!code) return "";
  try {
    return languageName(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function AudioTrackMenu({
  serverTracks,
  selectedServerTrackIndex = 0,
  onSelectServerTrack,
  ...props
}: AudioTrackMenuProps = {}) {
  // If server-side probed audio tracks are provided (e.g. direct/remux MP4 where browser video.audioTracks is unsupported)
  if (serverTracks && serverTracks.length >= 1) {
    const selectedTrack = serverTracks.find((t) => t.index === selectedServerTrackIndex) ?? serverTracks[0];
    const trackLabel = (t: ServerAudioTrack) => {
      const lang = formatLanguage(t.language);
      const label = lang || `Track ${t.index + 1}`;
      const details = [t.codec?.toUpperCase(), t.channels ? `${t.channels}ch` : ''].filter(Boolean).join(' ');
      return details ? `${label} (${details})` : label;
    };

    return (
      <Menu.Root {...props}>
        <Menu.Trigger
          className={menuTriggerClass}
        >
          <SpeechIconPrimitive
            className={menuIconClass}
          />
          <TextPrimitive token={audioText.key}>{audioText.text}</TextPrimitive>
          <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
            <span className={'max-w-24 truncate opacity-65 text-xs'}>{trackLabel(selectedTrack)}</span>
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
            <TextPrimitive token={audioText.key}>{audioText.text}</TextPrimitive>
          </Menu.Item>
          <Menu.Separator
            className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
          />
          <Menu.RadioGroup
            value={String(selectedServerTrackIndex)}
            onValueChange={(val) => onSelectServerTrack?.(Number(val))}
            className="flex flex-col gap-0.5"
          >
            {serverTracks.map((track) => (
              <RadioItem
                key={track.index}
                value={String(track.index)}
              >
                <span className="flex-1 text-xs truncate">
                  {trackLabel(track)}
                  {track.isDefault ? ' (Default)' : ''}
                  {track.prepared === false && (
                    <span className="opacity-60"> · prepares on select</span>
                  )}
                </span>
              </RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Root>
    );
  }

  // Default native AudioTrackRadioGroup for HLS or browsers with native audioTracks
  return (
    <Menu.Root {...props}>
      <AudioTrackRadioGroup.Root>
        <Menu.Trigger
          className={menuTriggerClassWithAvailability}
        >
          <SpeechIconPrimitive
            className={menuIconClass}
          />
          <TextPrimitive token={audioText.key}>{audioText.text}</TextPrimitive>
          <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
            <AudioTrackRadioGroup.Value className={'max-w-24 truncate opacity-65'} />
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
            <TextPrimitive token={audioText.key}>{audioText.text}</TextPrimitive>
          </Menu.Item>
          <Menu.Separator
            className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
          />
          <AudioTrackRadioGroup.Options
            className={menuOptionsClass}
            renderItem={(props, item) => (
              <RadioItem {...props}>
                <span>{item.label}</span>
              </RadioItem>
            )}
          ></AudioTrackRadioGroup.Options>
        </Menu.Content>
      </AudioTrackRadioGroup.Root>
    </Menu.Root>
  );
}
