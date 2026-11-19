'use client';

import { speedText } from '@videojs/core/i18n/text/menu';
import { Menu } from '@videojs/react';
import { Text as TextPrimitive } from '@videojs/react';
import { SpeedIcon as SpeedIconPrimitive } from '@videojs/react/icons/neutral';
import { PlaybackRateRadioGroup } from '@videojs/react/ui/playback-rate-radio-group';

import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuIconClass,
  menuOptionsClass,
  menuTriggerClassWithAvailability,
} from '@/components/videojs/ui/menu-styles';
import { RadioItem } from '@/components/videojs/ui/radio-item';

export type PlaybackRateSubmenuProps = Omit<Menu.RootProps, 'children'>;

export function PlaybackRateSubmenu({ ...props }: PlaybackRateSubmenuProps = {}) {
  return (
    <Menu.Root {...props}>
      <PlaybackRateRadioGroup.Root>
        <Menu.Trigger
          className={menuTriggerClassWithAvailability}
        >
          <SpeedIconPrimitive
            className={menuIconClass}
          />
          <TextPrimitive token={speedText.key}>{speedText.text}</TextPrimitive>
          <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
            <PlaybackRateRadioGroup.Value className={'max-w-24 truncate opacity-65'} />
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
            <TextPrimitive token={speedText.key}>{speedText.text}</TextPrimitive>
          </Menu.Item>
          <Menu.Separator
            className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
          />
          <PlaybackRateRadioGroup.Options
            className={menuOptionsClass}
            renderItem={(props, item) => (
              <RadioItem {...props}>
                <span>{item.label}</span>
              </RadioItem>
            )}
          ></PlaybackRateRadioGroup.Options>
        </Menu.Content>
      </PlaybackRateRadioGroup.Root>
    </Menu.Root>
  );
}
