'use client';

import { qualityText } from '@videojs/core/i18n/text/menu';
import { Menu } from '@videojs/react';
import { Text as TextPrimitive } from '@videojs/react';
import { SwitchesIcon as SwitchesIconPrimitive } from '@videojs/react/icons/neutral';
import { QualityRadioGroup } from '@videojs/react/ui/quality-radio-group';

import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuIconClass,
  menuOptionsClass,
  menuTriggerClassWithAvailability,
} from '@/components/videojs/ui/menu-styles';
import { RadioItem } from '@/components/videojs/ui/radio-item';

export type QualityMenuProps = Omit<Menu.RootProps, 'children'>;

export function QualityMenu({ ...props }: QualityMenuProps = {}) {
  return (
    <Menu.Root {...props}>
      <QualityRadioGroup.Root>
        <Menu.Trigger
          className={menuTriggerClassWithAvailability}
        >
          <SwitchesIconPrimitive
            className={menuIconClass}
          />
          <TextPrimitive token={qualityText.key}>{qualityText.text}</TextPrimitive>
          <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
            <QualityRadioGroup.Value className={'max-w-24 truncate opacity-65'} />
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
            <TextPrimitive token={qualityText.key}>{qualityText.text}</TextPrimitive>
          </Menu.Item>
          <Menu.Separator
            className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
          />
          <QualityRadioGroup.Options
            className={menuOptionsClass}
            renderItem={(props, item) => (
              <RadioItem {...props}>
                <span>
                  <span>{item.label}</span>
                  {item.tier ? (
                    <sup className={'ps-0.5 pt-px text-media-xs font-semibold leading-none opacity-70'}>
                      {item.tier}
                    </sup>
                  ) : null}
                </span>
                {item.badge ? (
                  <span className={'rounded-media-control bg-media-accent px-1.5 text-media-xs font-semibold'}>
                    {item.badge}
                  </span>
                ) : null}
              </RadioItem>
            )}
          ></QualityRadioGroup.Options>
        </Menu.Content>
      </QualityRadioGroup.Root>
    </Menu.Root>
  );
}
