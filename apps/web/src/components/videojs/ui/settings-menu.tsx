'use client';

import { settingsText } from '@videojs/core/i18n/text/menu';
import { Menu } from '@videojs/react';
import { Text as TextPrimitive } from '@videojs/react';
import { GearIcon as GearIconPrimitive } from '@videojs/react/icons/neutral';
import type { ClassValue } from 'cn';

import { Button } from '@/components/videojs/ui/button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import {
  menuContentClass,
  popoverChromeClass,
  popoverSurfaceClass,
} from '@/components/videojs/ui/menu-styles';
import { cn, resolveClassName } from '@/lib/resolve-class-name';

export interface SettingsMenuProps extends Omit<Menu.RootProps, 'children'> {
  className?: ClassValue;

  children?: Menu.ContentProps['children'];
}

export function SettingsMenu({ children, className, ...props }: SettingsMenuProps) {
  return (
    <Menu.Root side="top" align="center" {...props}>
      <ButtonTooltip label={<TextPrimitive token={settingsText.key}>{settingsText.text}</TextPrimitive>} side="top">
        <Menu.Trigger
          render={<Button />}
          className={(state) => cn('group/settings', resolveClassName(className, state))}
        >
          <GearIconPrimitive
            className={cn(
              'col-start-1 row-start-1 size-media-icon drop-shadow-media-icon [text-shadow:inherit]',
              'transition-transform duration-media-base ease-in-out motion-reduce:transition-none',
              'group-aria-expanded/settings:rotate-90'
            )}
          />
          <TextPrimitive className={'sr-only'} token={settingsText.key}>
            {settingsText.text}
          </TextPrimitive>
        </Menu.Trigger>
      </ButtonTooltip>
      <Menu.Popup
        keepMounted
        className={cn(
            popoverChromeClass,
            popoverSurfaceClass,
          'z-50 m-0 min-w-44 max-w-(--media-menu-available-width) overflow-hidden! rounded-media-popup border-0 p-1 [--media-popup-side-offset:var(--media-popover-side-offset)]',
          '[--media-control-size:2.25rem] [--media-icon-size:1.125rem]',
          'max-h-[min(var(--media-menu-available-height,--spacing(80)),--spacing(80))] overscroll-none',
          'h-(--media-menu-height) w-(--media-menu-width)',
          'transition-media-popup media-transitioning:transition-media-popup',
          'transition-media-menu-resize'
        )}
      >
        <Menu.Content
          className={menuContentClass}
        >
          {children}
        </Menu.Content>
      </Menu.Popup>
    </Menu.Root>
  );
}
