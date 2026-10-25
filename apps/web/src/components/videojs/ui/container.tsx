'use client';

import { Container as ContainerPrimitive } from '@videojs/react';

import { cn } from '@/lib/resolve-class-name';

export interface ContainerProps extends Omit<ContainerPrimitive.Props, 'children'> {
  children?: ContainerPrimitive.Props['children'];
}

export function Container({ children, className, ...props }: ContainerProps) {
  return (
    <ContainerPrimitive
      className={cn(
        'media-skin',
        'relative isolate block h-full w-full overflow-clip rounded-media-player bg-media-background @container/media-root',
        '[--spacing:var(--media-spacing)] font-media text-media leading-normal subpixel-antialiased',
        className
      )}
      {...props}
    >
      {children}
    </ContainerPrimitive>
  );
}
