'use client';

import { captionsText } from '@videojs/core/i18n/text/menu';
import { Menu } from '@videojs/react';
import { Text as TextPrimitive } from '@videojs/react';
import { CaptionsOffIcon as CaptionsOffIconPrimitive } from '@videojs/react/icons/neutral';
import { CaptionsRadioGroup } from '@videojs/react/ui/captions-radio-group';

import { MenuChevron } from '@/components/videojs/ui/menu-chevron';
import {
  menuBackItemClass,
  menuContentClass,
  menuIconClass,
  menuOptionsClass,
  menuTriggerClassWithAvailability,
} from '@/components/videojs/ui/menu-styles';
import { RadioItem } from '@/components/videojs/ui/radio-item';

export type CaptionsSubmenuProps = Omit<Menu.RootProps, 'children'>;

export function CaptionsSubmenu({ ...props }: CaptionsSubmenuProps = {}) {
  return (
    <Menu.Root {...props}>
      <CaptionsRadioGroup.Root>
        <Menu.Trigger
          className={menuTriggerClassWithAvailability}
        >
          <CaptionsOffIconPrimitive
            className={menuIconClass}
          />
          <TextPrimitive token={captionsText.key}>{captionsText.text}</TextPrimitive>
          <span className={'ms-auto inline-flex min-w-0 items-center gap-1 ps-2'}>
            <CaptionsRadioGroup.Value className={'max-w-24 truncate opacity-65'} />
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
            <TextPrimitive token={captionsText.key}>{captionsText.text}</TextPrimitive>
          </Menu.Item>
          <Menu.Separator
            className={'my-1 block border-b border-media-border media-high-contrast:border-media-foreground/25'}
          />
          <CaptionsRadioGroup.Options
            className={menuOptionsClass}
            renderItem={(props, item) => {
              // Track labels are formatted as "Name · Language" so native
              // menus still contain both. Split the two here so the in-player
              // menu can put the language above the name, even on narrow
              // screens where one long line would truncate.
              const [name, ...rest] = item.label.split(" · ");
              const detail = rest.join(" · ");
              return (
                <RadioItem {...props}>
                  <span className="flex min-w-0 flex-1 flex-col text-left">
                    {detail ? (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-media-muted-foreground">
                        {detail}
                      </span>
                    ) : null}
                    <span title={name} className="line-clamp-2 whitespace-normal">{name}</span>
                  </span>
                </RadioItem>
              );
            }}
          ></CaptionsRadioGroup.Options>
        </Menu.Content>
      </CaptionsRadioGroup.Root>
    </Menu.Root>
  );
}
