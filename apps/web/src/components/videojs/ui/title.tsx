'use client';

import { Title as TitlePrimitive } from '@videojs/react';

import { cn, resolveClassName } from '@/lib/resolve-class-name';

export type TitleProps = Omit<TitlePrimitive.Props, 'children'>;

export function Title({ className, ...props }: TitleProps = {}) {
  return (
    <TitlePrimitive
      className={(state) =>
        cn(
          'pointer-events-none absolute inset-x-0 top-0 z-20 isolate',
          'wrap-anywhere text-[calc(var(--media-spacing)*4)] tracking-[-0.0125em] text-media-controls-foreground text-shadow-media',
          'media-md:px-6',
          'origin-top duration-media-controls-enter ease-out',
          'not-data-visible:opacity-0 not-data-visible:duration-media-controls',
          'pointer-fine:not-data-visible:blur-media-hidden',
          'font-normal px-4 pt-3.5 media-md:pt-5',
          'transition-[filter,opacity,translate]',
          'not-data-visible:-translate-y-[min(var(--media-hidden-offset),var(--media-control-size))]',
          resolveClassName(className, state)
        )
      }
      {...props}
    />
  );
}
