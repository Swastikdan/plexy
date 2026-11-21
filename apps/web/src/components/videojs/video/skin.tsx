'use client';

import '@/components/videojs/styles/video/neutral.css';
import type { ComponentProps, ReactNode } from 'react';

import { BufferingIndicator } from '@/components/videojs/ui/buffering-indicator';
import { Container } from '@/components/videojs/ui/container';
import { ErrorDialog } from '@/components/videojs/ui/error-dialog';
import { Poster } from '@/components/videojs/ui/poster';
import { cn } from '@/lib/resolve-class-name';

import { VideoGestures } from './behaviors/gestures';
import { VideoHotkeys } from './behaviors/hotkeys';
import { VideoStatusIndicators } from './display/status-indicators';
import { NeutralVideoControls } from './layout/controls';

export interface VideoSkinProps extends Omit<NonNullable<ComponentProps<typeof Container>>, 'children'> {
  children?: ReactNode;
  title?: string;
  subtitle?: string | null;
  /** Render the built-in Video.js error dialog. Off while a retry is recovering. */
  showErrorDialog?: boolean;
  renderPoster?: NonNullable<ComponentProps<typeof Poster>>['renderImage'];
  renderThumbnail?: NonNullable<ComponentProps<typeof NeutralVideoControls>>['renderThumbnail'];
  onSeekDragStart?: () => void;
  onSeekDragEnd?: () => void;
  serverAudioTracks?: NonNullable<ComponentProps<typeof NeutralVideoControls>>['serverAudioTracks'];
  selectedAudioIndex?: number;
  onSelectAudioTrack?: (index: number) => void;
  subtitleOffset?: number;
  onAdjustSubtitleOffset?: (delta: number) => void;
  onResetSubtitleOffset?: () => void;
  subtitlePosition?: number;
  onAdjustSubtitlePosition?: (delta: number) => void;
  onResetSubtitlePosition?: () => void;
  chapters?: NonNullable<ComponentProps<typeof NeutralVideoControls>>['chapters'];
  onSelectChapter?: (start: number) => void;
  versions?: NonNullable<ComponentProps<typeof NeutralVideoControls>>['versions'];
  selectedFileId?: number;
  onSelectVersion?: (fileId: number) => void;
}

export function VideoSkin({
  children,
  className,
  title,
  subtitle,
  showErrorDialog = true,
  renderPoster,
  renderThumbnail,
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
  ...props
}: VideoSkinProps = {}) {
  return (
    <Container
      className={cn('pointer-fine:not-data-controls-visible:cursor-none', className)}
      data-theme="neutral"
      data-preset="video"
      {...props}
    >
      {children}
      <Poster renderImage={renderPoster} />
      <BufferingIndicator />
      {showErrorDialog && <ErrorDialog />}

      <NeutralVideoControls
        title={title}
        subtitle={subtitle}
        renderThumbnail={renderThumbnail}
        onSeekDragStart={onSeekDragStart}
        onSeekDragEnd={onSeekDragEnd}
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

      <VideoHotkeys />
      <VideoGestures />
      <VideoStatusIndicators />
    </Container>
  );
}
