'use client';

import { Menu } from '@videojs/react';
import { PlaybackRateRadioGroup } from '@videojs/react/ui/playback-rate-radio-group';

import { Button } from '@/components/videojs/ui/button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import {
  menuContentClass,
  menuOptionsClass,
  popoverChromeClass,
  popoverSurfaceClass,
} from '@/components/videojs/ui/menu-styles';
import { RadioItem } from '@/components/videojs/ui/radio-item';
import { cn } from '@/lib/resolve-class-name';

/// The current speed as a plain text shortcut in the control bar, matching
/// the reference player. The same choices remain available in Settings.
export function PlaybackRateMenu() {
  return (
    <Menu.Root side="top" align="center">
      <PlaybackRateRadioGroup.Root formatRate={(rate) => `${rate}x`}>
        <ButtonTooltip label="Playback speed" side="top">
          <Menu.Trigger
            render={<Button />}
            className="group/rate text-[15px] font-semibold tabular-nums tracking-tight data-[availability=unavailable]:hidden"
          >
            <PlaybackRateRadioGroup.Value className="block leading-none" />
          </Menu.Trigger>
        </ButtonTooltip>
        <Menu.Popup
          keepMounted
          className={cn(
            popoverChromeClass,
            popoverSurfaceClass,
            'm-0 min-w-32 max-w-(--media-menu-available-width) overflow-hidden! rounded-media-popup border-0 p-1 [--media-popup-side-offset:var(--media-popover-side-offset)]',
            '[--media-control-size:2.25rem] [--media-icon-size:1.125rem]',
            'max-h-[min(var(--media-menu-available-height,--spacing(56)),--spacing(56))] overscroll-none',
            'h-(--media-menu-height) w-(--media-menu-width)',
            'transition-media-popup media-transitioning:transition-media-popup',
            'transition-media-menu-resize'
          )}
        >
          <Menu.Content className={menuContentClass}>
            <PlaybackRateRadioGroup.Options
              className={menuOptionsClass}
              renderItem={(props, item) => <RadioItem {...props}>{item.label}</RadioItem>}
            />
          </Menu.Content>
        </Menu.Popup>
      </PlaybackRateRadioGroup.Root>
    </Menu.Root>
  );
}
