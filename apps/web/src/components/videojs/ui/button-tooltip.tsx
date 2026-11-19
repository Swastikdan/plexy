'use client';

import { Tooltip } from '@videojs/react';
import type { ReactElement, ReactNode } from 'react';

import { popoverBridgeClass, popoverChromeClass, popoverSurfaceClass } from '@/components/videojs/ui/menu-styles';
import { cn } from '@/lib/resolve-class-name';

export interface ButtonTooltipProps extends Omit<Tooltip.RootProps, 'children'> {
  children: ReactElement;
  label?: ReactNode;
}

export function ButtonTooltip({ children, label, ...props }: ButtonTooltipProps) {
  return (
    <Tooltip.Root {...props}>
      <Tooltip.Trigger render={children} />
      <Tooltip.Popup
        className={cn(
          popoverChromeClass,
          popoverBridgeClass,
          popoverSurfaceClass,
          'whitespace-nowrap rounded-media-control py-1 text-media [--media-popup-side-offset:var(--media-tooltip-side-offset)]',
          'data-open:flex data-open:items-center data-open:gap-1',
          'px-2',
          'shadow-media-tooltip!'
        )}
      >
        {label ?? <Tooltip.Label />}
        {!label && (
          <Tooltip.Shortcut
            className={cn(
              'min-w-[1.5em] rounded-[--spacing(1)] bg-media-muted p-[0.1em] text-center text-media-sm [font-family:inherit] font-semibold leading-tight',
              '-me-1'
            )}
          />
        )}
      </Tooltip.Popup>
    </Tooltip.Root>
  );
}
