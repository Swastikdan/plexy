import { Controls, Time, Tooltip } from '@videojs/react';
import type { ComponentProps } from 'react';

import { AirPlayButton } from '@/components/videojs/ui/airplay-button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { CaptionsButton } from '@/components/videojs/ui/captions-button';
import { CastButton } from '@/components/videojs/ui/cast-button';
import { FullscreenButton } from '@/components/videojs/ui/fullscreen-button';
import { PiPButton } from '@/components/videojs/ui/pip-button';
import { PlayButton } from '@/components/videojs/ui/play-button';
import { PlaybackRateMenu } from '@/components/videojs/ui/playback-rate-menu';
import { SeekBackwardButton, SeekForwardButton } from '@/components/videojs/ui/seek-buttons';
import { TimeSlider, type TimeSliderThumbnails } from '@/components/videojs/ui/time-slider';
import { VolumeControl } from '@/components/videojs/ui/volume-control';
import { cn } from '@/lib/resolve-class-name';

import { VideoSettingsMenu, type VideoSettingsMenuProps } from '@/components/videojs/video/menus/settings-menu';
import type { Chapter } from '@/components/videojs/ui/chapters-menu';
import type { Playability } from '@plexy/api-client';

export interface NeutralVideoControlsProps {
  title?: string | null;
  subtitle?: string | null;
  renderThumbnail?: NonNullable<ComponentProps<typeof TimeSlider>>['renderThumbnail'];
  /** Direct trickplay entries for surfaces without a `<video>` text-track host. */
  thumbnails?: TimeSliderThumbnails;
  onSeekDragStart?: () => void;
  onSeekDragEnd?: () => void;
  serverAudioTracks?: VideoSettingsMenuProps['serverAudioTracks'];
  selectedAudioIndex?: number;
  onSelectAudioTrack?: (index: number) => void;
  subtitleOffset?: number;
  onAdjustSubtitleOffset?: (delta: number) => void;
  onResetSubtitleOffset?: () => void;
  subtitlePosition?: number;
  onAdjustSubtitlePosition?: (delta: number) => void;
  onResetSubtitlePosition?: () => void;
  chapters?: Chapter[];
  onSelectChapter?: (start: number) => void;
  versions?: NonNullable<Playability['versions']>;
  selectedFileId?: number;
  onSelectVersion?: (fileId: number) => void;
}

/// Cinema controls matching the Plexy player reference: one full-width seek
/// line with the elapsed/total time beside the transport, then a single row
/// of utilities on the right. Each player page owns its own title chrome.
export function NeutralVideoControls({
  renderThumbnail,
  thumbnails,
  onSeekDragStart,
  onSeekDragEnd,
  serverAudioTracks,
  selectedAudioIndex,
  onSelectAudioTrack,
  subtitleOffset,
  onAdjustSubtitleOffset,
  onResetSubtitleOffset,
  subtitlePosition,
  onAdjustSubtitlePosition,
  onResetSubtitlePosition,
  chapters,
  onSelectChapter,
  versions,
  selectedFileId,
  onSelectVersion,
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
          'absolute inset-x-0 bottom-0 z-30 flex flex-col items-stretch px-4 pb-1.5',
          '[--media-primary:var(--accent)] [--media-primary-foreground:var(--accent-foreground)]',
          'transition-[filter,opacity,translate]',
          'not-data-visible:pointer-events-none not-data-visible:opacity-0',
          'not-data-visible:duration-media-controls',
          'not-data-visible:translate-y-media-hidden-offset pointer-fine:not-data-visible:blur-media-hidden'
        )}
      >
        <Tooltip.Provider>
          <div className="px-0.5">
            <TimeSlider
              previewOverflow="clamp"
              renderThumbnail={renderThumbnail}
              thumbnails={thumbnails}
              onDragStart={onSeekDragStart}
              onDragEnd={onSeekDragEnd}
              className="[--media-slider-height:1.5rem]"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-1.5 [--media-control-size:2.75rem] [--media-icon-size:1.375rem]">
            <Controls.Group className="flex items-center gap-0 text-white/70 rtl:flex-row-reverse [&_button:hover]:text-white [&_button:focus-visible]:text-white">
              <SeekBackwardButton seconds={-10} />
              <ButtonTooltip side="top">
                <PlayButton />
              </ButtonTooltip>
              <SeekForwardButton seconds={10} />
              <VolumeControl showTooltip />
              <Time.Group className="flex shrink-0 items-center gap-1.5 pl-2.5 text-[15px] font-semibold leading-none tabular-nums text-white/70">
                <Time.Value type="current" className="tabular-nums" />
                <span aria-hidden className="text-white/35">
                  /
                </span>
                <Time.Value type="duration" className="tabular-nums" />
              </Time.Group>
            </Controls.Group>

            <Controls.Group className="flex items-center justify-end gap-0 text-white/70 rtl:flex-row-reverse [&_button:hover]:text-white [&_button:focus-visible]:text-white">
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
                <CaptionsButton />
              </ButtonTooltip>
              <PlaybackRateMenu />
              <VideoSettingsMenu
                serverAudioTracks={serverAudioTracks}
                selectedAudioIndex={selectedAudioIndex}
                onSelectAudioTrack={onSelectAudioTrack}
                subtitleOffset={subtitleOffset}
                onAdjustSubtitleOffset={onAdjustSubtitleOffset}
                onResetSubtitleOffset={onResetSubtitleOffset}
                subtitlePosition={subtitlePosition}
                onAdjustSubtitlePosition={onAdjustSubtitlePosition}
                onResetSubtitlePosition={onResetSubtitlePosition}
                chapters={chapters}
                onSelectChapter={onSelectChapter}
                versions={versions}
                selectedFileId={selectedFileId}
                onSelectVersion={onSelectVersion}
              />
              <ButtonTooltip side="top">
                <FullscreenButton />
              </ButtonTooltip>
            </Controls.Group>
          </div>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
