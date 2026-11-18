'use client';

import type { MouseEventHandler } from 'react';
import { FullscreenButton as FullscreenButtonPrimitive } from '@videojs/react';
import {
  FullscreenEnterIcon as FullscreenEnterIconPrimitive,
  FullscreenExitIcon as FullscreenExitIconPrimitive,
} from '@videojs/react/icons/neutral';

import { Button } from '@/components/videojs/ui/button';
import { cn } from '@/lib/resolve-class-name';
import { useIsFullscreen } from '@/lib/use-fullscreen';

export interface FullscreenButtonProps {
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

function FullscreenIcons() {
  return (
    <>
      <FullscreenEnterIconPrimitive
        className={cn(
          'col-start-1 row-start-1 size-media-icon drop-shadow-media-icon [text-shadow:inherit]',
          'transition-[opacity,scale] duration-media-base ease-out',
          'opacity-0 group-not-data-fullscreen/fullscreen:scale-100 group-not-data-fullscreen/fullscreen:opacity-100'
        )}
      />
      <FullscreenExitIconPrimitive
        className={cn(
          'col-start-1 row-start-1 size-media-icon drop-shadow-media-icon [text-shadow:inherit]',
          'transition-[opacity,scale] duration-media-base ease-out',
          'opacity-0 group-data-fullscreen/fullscreen:scale-100 group-data-fullscreen/fullscreen:opacity-100'
        )}
      />
    </>
  );
}

/**
 * The desktop app toggles the native window instead of asking Chromium for
 * element fullscreen. Element fullscreen puts the page in its own opaque
 * compositor surface, which hides the embedded libmpv view (black video);
 * native window fullscreen keeps the transparent page over the video surface.
 */
function DesktopFullscreenButton({ className, onClick }: FullscreenButtonProps) {
  const isFullscreen = useIsFullscreen();
  return (
    <Button
      className={cn('group/fullscreen', className)}
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      data-fullscreen={isFullscreen || undefined}
      onClick={(event) => {
        onClick?.(event);
        const pending = window.electronAPI?.setFullScreen?.(!isFullscreen);
        if (pending) void pending.catch(() => {});
      }}
    >
      <FullscreenIcons />
    </Button>
  );
}

export function FullscreenButton({ className, onClick }: FullscreenButtonProps = {}) {
  if (typeof window !== 'undefined' && window.electronAPI?.setFullScreen) {
    return <DesktopFullscreenButton className={className} onClick={onClick} />;
  }
  return (
    <FullscreenButtonPrimitive
      render={<Button />}
      className={cn('group/fullscreen', className)}
      onClick={onClick}
    >
      <FullscreenIcons />
    </FullscreenButtonPrimitive>
  );
}
