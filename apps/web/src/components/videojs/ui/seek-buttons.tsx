'use client';

import '../styles/themes/neutral.css';
import '../styles/base.css';
import '../styles/audio/theme.css';
import '../styles/video/captions.css';
import '../styles/video/theme.css';
import { SeekButton as SeekButtonPrimitive } from '@videojs/react';
import { RotateCcw, RotateCw } from 'lucide-react';

import { Button } from '@/components/videojs/ui/button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { cn } from '@/lib/resolve-class-name';

export interface SeekButtonProps {
  seconds?: number;
  className?: string;
}

export function SeekBackwardButton({ seconds = -10, className }: SeekButtonProps) {
  const abs = Math.abs(seconds);
  return (
    <ButtonTooltip side="top" label={`Rewind ${abs}s`}>
      <SeekButtonPrimitive
        seconds={seconds}
        render={<Button className={cn('relative', className)} />}
        aria-label={`Rewind ${abs} seconds`}
      >
        <RotateCcw className="size-media-icon drop-shadow-media-icon [text-shadow:inherit]" />
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold select-none leading-none pt-0.5">
          {abs}
        </span>
      </SeekButtonPrimitive>
    </ButtonTooltip>
  );
}

export function SeekForwardButton({ seconds = 10, className }: SeekButtonProps) {
  const abs = Math.abs(seconds);
  return (
    <ButtonTooltip side="top" label={`Forward ${abs}s`}>
      <SeekButtonPrimitive
        seconds={seconds}
        render={<Button className={cn('relative', className)} />}
        aria-label={`Forward ${abs} seconds`}
      >
        <RotateCw className="size-media-icon drop-shadow-media-icon [text-shadow:inherit]" />
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold select-none leading-none pt-0.5">
          {abs}
        </span>
      </SeekButtonPrimitive>
    </ButtonTooltip>
  );
}
