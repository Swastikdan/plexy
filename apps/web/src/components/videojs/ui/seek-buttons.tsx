'use client';

import { SeekButton as SeekButtonPrimitive } from '@videojs/react';
import { RotateCcw, RotateCw } from 'lucide-react';

import { Button } from '@/components/videojs/ui/button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';

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
        render={<Button className={className} />}
        aria-label={`Rewind ${abs} seconds`}
      >
        <RotateCcw className="size-media-icon drop-shadow-media-icon [text-shadow:inherit]" />
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
        render={<Button className={className} />}
        aria-label={`Forward ${abs} seconds`}
      >
        <RotateCw className="size-media-icon drop-shadow-media-icon [text-shadow:inherit]" />
      </SeekButtonPrimitive>
    </ButtonTooltip>
  );
}
