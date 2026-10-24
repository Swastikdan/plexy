import { Controls, Time, Tooltip } from '@videojs/react';
import type { ComponentProps } from 'react';

import { AirPlayButton } from '@/components/videojs/ui/airplay-button';
import { AudioTrackButton } from '@/components/videojs/ui/audio-track-button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { CaptionsButton } from '@/components/videojs/ui/captions-button';
import { CastButton } from '@/components/videojs/ui/cast-button';
import { FullscreenButton } from '@/components/videojs/ui/fullscreen-button';
import { PiPButton } from '@/components/videojs/ui/pip-button';
import { PlayButton } from '@/components/videojs/ui/play-button';
import { SeekBackwardButton, SeekForwardButton } from '@/components/videojs/ui/seek-buttons';
import { TimeSlider } from '@/components/videojs/ui/time-slider';
import { VolumePopover } from '@/components/videojs/ui/volume-popover';
import { cn } from '@/lib/resolve-class-name';

import { VideoSettingsMenu, type VideoSettingsMenuProps } from '../menus/settings-menu';

export interface NeutralVideoControlsProps {
  renderThumbnail?: NonNullable<ComponentProps<typeof TimeSlider>>['renderThumbnail'];
  serverAudioTracks?: VideoSettingsMenuProps['serverAudioTracks'];
  selectedAudioIndex?: number;
  onSelectAudioTrack?: (index: number) => void;
  subtitleOffset?: number;
  onAdjustSubtitleOffset?: (delta: number) => void;
  onResetSubtitleOffset?: () => void;
}

export function NeutralVideoControls({
  renderThumbnail,
  serverAudioTracks,
  selectedAudioIndex,
  onSelectAudioTrack,
  subtitleOffset,
  onAdjustSubtitleOffset,
  onResetSubtitleOffset,
}: NeutralVideoControlsProps = {}) {
  return (
    <Controls.Root>
      <Controls.Backdrop
        className={cn(
          'pointer-events-none absolute inset-0 z-10 rounded-[inherit] bg-(image:--media-controls-gradient)',
          'transition-opacity duration-media-controls ease-out not-data-visible:opacity-0'
        )}
      />
      <Controls.Content
        className={cn(
          'video-controls',
          'group/controls text-media-controls-foreground text-shadow-media',
          'duration-media-controls-enter ease-out',
          'absolute inset-x-0.5 bottom-0.5 z-30 flex items-center rtl:flex-row-reverse gap-x-2 rounded-media-controls bg-transparent p-1 media-high-contrast:bg-media-background',
          'transition-[filter,opacity,translate]',
          'not-data-visible:pointer-events-none not-data-visible:opacity-0',
          'not-data-visible:duration-media-controls',
          'not-data-visible:translate-y-media-hidden-offset pointer-fine:not-data-visible:blur-media-hidden',
          'media-2xl:inset-x-2 media-2xl:bottom-2',
          'media-2xl:[--media-popover-side-offset:--spacing(3)]',
          'media-2xl:[--media-tooltip-side-offset:var(--media-popover-side-offset)]',
          'flex-wrap media-2xl:flex-nowrap'
        )}
      >
        <Tooltip.Provider>
          <Controls.Group className={'flex flex-1 items-center rtl:flex-row-reverse gap-0.5 media-2xl:flex-none'}>
            <SeekBackwardButton seconds={-10} />
            <ButtonTooltip side="top">
              <PlayButton />
            </ButtonTooltip>
            <SeekForwardButton seconds={10} />
            <VolumePopover showTooltip side="right" orientation="horizontal" />
          </Controls.Group>

          <Controls.Group
            className={cn(
              '@container/video-time-controls -order-1 flex flex-none basis-full flex-row-reverse items-center rtl:flex-row gap-3 px-1.5',
              '[--media-slider-height:--spacing(5)]',
              'media-2xl:order-none media-2xl:min-w-0 media-2xl:flex-1 media-2xl:flex-row media-2xl:rtl:flex-row-reverse',
              'media-2xl:[--media-slider-height:--spacing(8)]',
              'media-2xl:mask-media-volume media-2xl:[mask-size:200%_100%]',
              'group-has-[[data-volume-level][aria-expanded=true]]/controls:media-2xl:mask-media-volume-open'
            )}
          >
            <Time.Group className={'flex items-center rtl:flex-row-reverse gap-1'}>
              <Time.Value
                className={cn(
                  'cursor-pointer rounded-sm tabular-nums focus-ring-media',
                  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
                  'transition-[outline-color,outline-offset] duration-media-fast ease-out',
                  'focus-visible:outline-media-ring focus-visible:outline-offset-2',
                  'supports-[corner-shape:squircle]:rounded-2xl supports-[corner-shape:squircle]:[corner-shape:squircle]'
                )}
                type="current"
                toggle
              />
              <Time.Separator className={'hidden media-2xl:inline media-2xl:text-media-controls-foreground/60'} />
              <Time.Value
                className={
                  'hidden tabular-nums transition-opacity duration-media-slow ease-out data-unavailable:opacity-50 media-2xl:inline media-2xl:text-media-controls-foreground/60'
                }
                type="duration"
              />
            </Time.Group>
            <TimeSlider previewOverflow="clamp" renderThumbnail={renderThumbnail} />
          </Controls.Group>

          <Controls.Group
            className={cn(
              'flex flex-1 items-center rtl:flex-row-reverse justify-end gap-px media-2xl:flex-none',
              'media-max-2xl:mask-media-volume media-max-2xl:[mask-size:400%_100%]',
              'group-has-[[data-volume-level][aria-expanded=true]]/controls:media-max-2xl:mask-media-volume-open'
            )}
          >
            <AudioTrackButton
              tracks={serverAudioTracks}
              selectedIndex={selectedAudioIndex}
              onSelectTrack={onSelectAudioTrack}
            />
            <ButtonTooltip side="top">
              <CaptionsButton className={'media-max-xs:hidden'} />
            </ButtonTooltip>
            <VideoSettingsMenu
              serverAudioTracks={serverAudioTracks}
              selectedAudioIndex={selectedAudioIndex}
              onSelectAudioTrack={onSelectAudioTrack}
              subtitleOffset={subtitleOffset}
              onAdjustSubtitleOffset={onAdjustSubtitleOffset}
              onResetSubtitleOffset={onResetSubtitleOffset}
            />
            <Controls.Group className={'flex items-center rtl:flex-row-reverse gap-px'}>
              <ButtonTooltip side="top">
                <CastButton />
              </ButtonTooltip>
              <ButtonTooltip side="top">
                <AirPlayButton />
              </ButtonTooltip>
              <ButtonTooltip side="top">
                <PiPButton />
              </ButtonTooltip>
              <ButtonTooltip side="top">
                <FullscreenButton />
              </ButtonTooltip>
            </Controls.Group>
          </Controls.Group>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
