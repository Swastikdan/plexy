'use client';

import type { MouseEventHandler } from 'react';
import { FullscreenButton as FullscreenButtonPrimitive } from '@videojs/react';

import { Button } from '@/components/videojs/ui/button';
import { cn } from '@/lib/resolve-class-name';
import { useIsFullscreen } from '@/lib/use-fullscreen';

export interface FullscreenButtonProps {
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

/// Two diagonal arrows with right-angle heads: pointing out to enter, in to
/// leave. This matches the reference glyph without the focus ring drawn on top.
function FullscreenGlyph({ exit, className }: { exit: boolean; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-media-icon drop-shadow-media-icon [text-shadow:inherit]', className)}
    >
      {exit ? (
        <>
          <path d="M18.5 5.5 13 11" />
          <path d="M17 11h-4V7" />
          <path d="M5.5 18.5 11 13" />
          <path d="M7 13h4v4" />
        </>
      ) : (
        <>
          <path d="M13 11 18.5 5.5" />
          <path d="M14 5.5h4.5V10" />
          <path d="M11 13 5.5 18.5" />
          <path d="M10 18.5H5.5V14" />
        </>
      )}
    </svg>
  );
}

function FullscreenIcons() {
  return (
    <>
      <FullscreenGlyph
        exit={false}
        className={cn(
          'col-start-1 row-start-1',
          'transition-[opacity,scale] duration-media-base ease-out',
          'opacity-0 group-not-data-fullscreen/fullscreen:scale-100 group-not-data-fullscreen/fullscreen:opacity-100'
        )}
      />
      <FullscreenGlyph
        exit
        className={cn(
          'col-start-1 row-start-1',
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
