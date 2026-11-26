'use client';

import { Button, Slider, Tooltip } from '@heroui/react';
import { selectVolume } from '@videojs/core/dom';
import { usePlayer } from '@videojs/react/video';
import { VolumeX } from 'lucide-react';

import { cn } from '@/lib/resolve-class-name';

export interface VolumeControlProps {
  showTooltip?: boolean;
}

const iconClass = cn(
  'col-start-1 row-start-1 size-media-icon! drop-shadow-media-icon m-0! [text-shadow:inherit]',
  'transition-opacity duration-media-base ease-out'
);

/** Speaker with three waves so the current loudness is readable at a glance. */
function VolumeLevelIcon({ level }: { level: 0 | 1 | 2 | 3 }) {
  if (level === 0) return <VolumeX aria-hidden className={iconClass} />;

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={iconClass}
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path
        d="M16 9a5 5 0 0 1 0 6"
        opacity={level >= 1 ? 1 : 0.2}
        className="transition-opacity duration-media-base ease-out"
      />
      <path
        d="M19.364 18.364a9 9 0 0 0 0-12.728"
        opacity={level >= 2 ? 1 : 0.2}
        className="transition-opacity duration-media-base ease-out"
      />
      <path
        d="M22.2 21.4a12.8 12.8 0 0 0 0-18.8"
        opacity={level >= 3 ? 1 : 0.2}
        className="transition-opacity duration-media-base ease-out"
      />
    </svg>
  );
}

// Keep the mute button anchored and reveal the slider over the time display.
// Touch devices show the expanded control so the slider can be used directly.
export function VolumeControl({ showTooltip = false }: VolumeControlProps = {}) {
  const volume = usePlayer(selectVolume);

  if (!volume || volume.volumeAvailability !== 'available') return null;

  const muted = volume.muted;
  const percent = muted ? 0 : Math.round(volume.volume * 100);
  const silent = muted || percent === 0;
  const level: 0 | 1 | 2 | 3 = silent ? 0 : percent <= 33 ? 1 : percent <= 66 ? 2 : 3;

  const setPercent = (next: number) => {
    if (volume.muted && next > 0) volume.setMuted(false);
    volume.setVolume(next / 100);
  };

  const toggleMute = () => {
    if (muted) {
      volume.setMuted(false);
      if (volume.volume <= 0.001) volume.setVolume(0.5);
      return;
    }
    if (volume.volume <= 0.001) {
      volume.setVolume(0.5);
      return;
    }
    volume.setMuted(true);
  };

  const button = (
    <Button
      type="button"
      isIconOnly
      variant="tertiary"
      aria-label={silent ? 'Unmute' : 'Mute'}
      onPress={toggleMute}
      className={cn(
        'grid! size-media-control! shrink-0 place-items-center rounded-media-control p-0! text-inherit',
        '[--button-bg:transparent] [--button-bg-hover:transparent] [--button-bg-pressed:transparent]',
        'focus-ring-media focus-visible:shadow-none! focus-visible:outline-media-ring',
        '[&_svg]:m-0!'
      )}
    >
      <VolumeLevelIcon level={level} />
    </Button>
  );

  return (
    <div className="group/volume relative z-10 h-media-control w-media-control shrink-0 [--volume-expanded-width:calc(var(--media-control-size)+var(--volume-reveal))] [--volume-reveal:5rem]">
      <div
        className={cn(
          'absolute inset-y-0 left-0 flex w-(--volume-expanded-width) items-center overflow-hidden rounded-media-control',
          'bg-black pointer-fine:bg-transparent',
          'transition-[clip-path] duration-media-slow ease-[var(--ease-in-out)]',
          '[clip-path:inset(0_0_0_0)]',
          'pointer-fine:[clip-path:inset(0_var(--volume-reveal)_0_0)]',
          'pointer-fine:group-hover/volume:[clip-path:inset(0_0_0_0)]',
          'pointer-fine:group-hover/volume:bg-black',
          'pointer-fine:group-focus-within/volume:[clip-path:inset(0_0_0_0)]',
          'pointer-fine:group-focus-within/volume:bg-black',
          'supports-[corner-shape:squircle]:rounded-2xl',
          'motion-reduce:transition-none'
        )}
      >
        <div className="flex shrink-0">
          {showTooltip ? (
            <Tooltip delay={500} closeDelay={0}>
              <Tooltip.Trigger className="flex" tabIndex={-1}>
                {button}
              </Tooltip.Trigger>
              <Tooltip.Content placement="top" offset={8}>
                {muted ? 'Unmute' : 'Mute'}
              </Tooltip.Content>
            </Tooltip>
          ) : (
            button
          )}
        </div>

        <div
          className={cn(
            'flex h-full w-(--volume-reveal) shrink-0 items-center ps-2 pe-3',
            'transition-[opacity,translate] duration-media-base ease-out',
            'pointer-events-auto opacity-100',
            'pointer-fine:pointer-events-none pointer-fine:translate-x-1 pointer-fine:opacity-0',
            'pointer-fine:group-hover/volume:pointer-events-auto',
            'pointer-fine:group-hover/volume:translate-x-0 pointer-fine:group-hover/volume:opacity-100',
            'pointer-fine:group-focus-within/volume:pointer-events-auto',
            'pointer-fine:group-focus-within/volume:translate-x-0',
            'pointer-fine:group-focus-within/volume:opacity-100',
            'motion-reduce:transition-none'
          )}
        >
          <Slider
            aria-label="Volume"
            minValue={0}
            maxValue={100}
            step={1}
            value={percent}
            onChange={(next) => {
              setPercent(Array.isArray(next) ? next[0] ?? 0 : next);
            }}
            className={cn(
              'flex! w-full touch-none items-center gap-0!',
              '[--focus:var(--media-ring)]'
            )}
          >
            <Slider.Track
              className={cn(
                'relative h-6! w-full! cursor-pointer rounded-media-pill! border-x-0! bg-transparent!',
                'before:pointer-events-none before:absolute before:inset-x-0 before:top-1/2 before:h-1 before:-translate-y-1/2',
                'before:rounded-media-pill before:bg-white/20 before:content-[\'\']'
              )}
            >
              <Slider.Fill
                className="top-1/2! h-1! -translate-y-1/2! rounded-media-pill! bg-media-primary!"
              />
              <Slider.Thumb
                className={cn(
                  'size-3! rounded-media-control! bg-white! after:hidden!',
                  'shadow-media-thumb',
                  'transition-[scale] duration-media-base ease-out',
                  'data-dragging:scale-90',
                  'motion-reduce:transition-none'
                )}
              />
            </Slider.Track>
          </Slider>
        </div>
      </div>
    </div>
  );
}
