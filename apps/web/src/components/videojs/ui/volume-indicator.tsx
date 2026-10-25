'use client';

import { VolumeIndicator as VolumeIndicatorPrimitive } from '@videojs/react';
import {
  VolumeHighIcon as VolumeHighIconPrimitive,
  VolumeLowIcon as VolumeLowIconPrimitive,
  VolumeOffIcon as VolumeOffIconPrimitive,
} from '@videojs/react/icons/neutral';

import { cn, resolveClassName } from '@/lib/resolve-class-name';

export type VolumeIndicatorProps = Omit<VolumeIndicatorPrimitive.RootProps, 'children'>;

export function VolumeIndicator({ className, ...props }: VolumeIndicatorProps = {}) {
  return (
    <VolumeIndicatorPrimitive.Root
      className={(state) =>
        cn(
          'pointer-events-none absolute origin-top text-inherit',
          'duration-media-fast ease-out',
          'media-transitioning:opacity-0 media-transitioning:duration-media-indicator media-transitioning:ease-in',
          'inset-x-0 top-0 flex justify-center pt-3 pb-32 bg-(image:--media-indicator-gradient) text-shadow-media',
          'pointer-fine:motion-media-[translate,filter,opacity] pointer-coarse:motion-media-[translate,opacity]',
          'pointer-fine:media-transitioning:blur-media-hidden',
          'data-ending-style:translate-y-media-hidden-indicator-offset',
          'group/volume-status',
          resolveClassName(className, state)
        )
      }
      {...props}
    >
      <VolumeIndicatorPrimitive.Fill
        className={cn(
          'items-center justify-between gap-2 px-2.5 py-1',
          'media-high-contrast:rounded-media-control media-high-contrast:bg-media-background',
          'rounded-[inherit]',
          'grid w-[min(80%,14rem)] grid-cols-[auto_minmax(0,1fr)_auto] transform-[translateX(0)]',
          'before:col-start-2 before:row-start-1 before:h-0.75 before:w-full before:rounded-media-pill',
          'before:bg-current/20 before:shadow-[0_1px_0_var(--media-shadow-subtle-current-color)]',
          'after:col-start-2 after:row-start-1 after:h-0.75 after:w-(--media-volume-fill,0%) after:justify-self-start',
          'after:rounded-media-pill after:bg-media-primary',
          'after:transition-[width] after:duration-media-slow after:ease-linear',
          'motion-safe:group-[:is([data-min],[data-max]):not([data-starting-style],[data-ending-style])]/volume-status:nudge-media'
        )}
      >
        <VolumeHighIconPrimitive
          className={cn(
            'hidden shrink-0 group-data-[level=high]/volume-status:block',
            'col-start-1 row-start-1 drop-shadow-media-icon'
          )}
        />
        <VolumeLowIconPrimitive
          className={cn(
            'hidden shrink-0 group-data-[level=low]/volume-status:block',
            'col-start-1 row-start-1 drop-shadow-media-icon'
          )}
        />
        <VolumeOffIconPrimitive
          className={cn(
            'hidden shrink-0 group-data-[level=off]/volume-status:block',
            'col-start-1 row-start-1 drop-shadow-media-icon'
          )}
        />
        <VolumeIndicatorPrimitive.Value className={'col-start-3 row-start-1'} />
      </VolumeIndicatorPrimitive.Fill>
    </VolumeIndicatorPrimitive.Root>
  );
}
