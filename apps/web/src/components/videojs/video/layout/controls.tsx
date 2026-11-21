import { Controls, Time, Tooltip } from '@videojs/react';
import type { ComponentProps } from 'react';

import { AirPlayButton } from '@/components/videojs/ui/airplay-button';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { CaptionsButton } from '@/components/videojs/ui/captions-button';
import { CastButton } from '@/components/videojs/ui/cast-button';
import { FullscreenButton } from '@/components/videojs/ui/fullscreen-button';
import { PiPButton } from '@/components/videojs/ui/pip-button';
import { PlayButton } from '@/components/videojs/ui/play-button';
import { SeekBackwardButton, SeekForwardButton } from '@/components/videojs/ui/seek-buttons';
import { TimeSlider, type TimeSliderThumbnails } from '@/components/videojs/ui/time-slider';
import { VolumePopover } from '@/components/videojs/ui/volume-popover';
import { cn } from '@/lib/resolve-class-name';

import { VideoSettingsMenu, type VideoSettingsMenuProps } from '../menus/settings-menu';
import type { Chapter } from '@/components/videojs/ui/chapters-menu';
import type { Playability } from '@plexy/api-client';

export interface NeutralVideoControlsProps {
  title?: string | null;
  subtitle?: string | null;
  renderThumbnail?: NonNullable<ComponentProps<typeof TimeSlider>>['renderThumbnail'];
  /** Direct trickplay entries for surfaces without a `<video>` text-track host. */
  thumbnails?: TimeSliderThumbnails;
  /** `right` puts the volume rail beside the icon; `above` is the web default. */
  volumePlacement?: 'above' | 'right';
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

/// Cinema controls: title and time at the bottom corners, a hairline seek
/// track, then transport on the left and utilities on the right. This mirrors
/// the Plexy player reference rather than a generic video.js control bar.
export function NeutralVideoControls({
  title,
  subtitle,
  renderThumbnail,
  thumbnails,
  volumePlacement = 'above',
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
          'absolute inset-x-0 bottom-0 z-30 flex flex-col items-stretch gap-0 px-4 pb-2 pt-7 sm:px-5',
          'transition-[filter,opacity,translate]',
          'not-data-visible:pointer-events-none not-data-visible:opacity-0',
          'not-data-visible:duration-media-controls',
          'not-data-visible:translate-y-media-hidden-offset pointer-fine:not-data-visible:blur-media-hidden'
        )}
      >
        <Tooltip.Provider>
          <div className="flex items-end justify-between gap-4 px-1 pb-1.5">
            <div className="min-w-0">
              {title && (
                <p className="truncate text-[15px] font-semibold leading-tight text-white drop-shadow">
                  {title}
                </p>
              )}
              {subtitle && (
                <p className="mt-0.5 truncate text-[11px] font-medium leading-tight text-white/55">
                  {subtitle}
                </p>
              )}
            </div>
            <Time.Group className="flex shrink-0 items-center gap-1 pb-0.5 text-[11px] tabular-nums text-white/75">
              <Time.Value type="current" className="tabular-nums text-white/85" />
              <span aria-hidden className="text-white/35">
                /
              </span>
              <Time.Value type="duration" className="tabular-nums text-white/55" />
            </Time.Group>
          </div>

          <div className="px-0.5">
            <TimeSlider
              previewOverflow="clamp"
              renderThumbnail={renderThumbnail}
              thumbnails={thumbnails}
              onDragStart={onSeekDragStart}
              onDragEnd={onSeekDragEnd}
              className="[--media-slider-height:0.5rem]"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <Controls.Group className="flex items-center gap-0.5 rtl:flex-row-reverse">
              <ButtonTooltip side="top">
                <PlayButton />
              </ButtonTooltip>
              <SeekBackwardButton seconds={-10} />
              <SeekForwardButton seconds={10} />
            </Controls.Group>

            <Controls.Group className="flex items-center justify-end gap-0.5 rtl:flex-row-reverse">
              <VolumePopover
                showTooltip
                side={volumePlacement === 'right' ? 'right' : 'top'}
                orientation={volumePlacement === 'right' ? 'vertical' : 'horizontal'}
              />
              <ButtonTooltip side="top">
                <CaptionsButton className="media-max-xs:hidden" />
              </ButtonTooltip>
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
          </div>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
