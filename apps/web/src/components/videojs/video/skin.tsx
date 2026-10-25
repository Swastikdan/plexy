'use client';

import '../styles/video/neutral.css';
import type { ComponentProps, ReactNode } from 'react';

import { BufferingIndicator } from '@/components/videojs/ui/buffering-indicator';
import { Container } from '@/components/videojs/ui/container';
import { ErrorDialog } from '@/components/videojs/ui/error-dialog';
import { Poster } from '@/components/videojs/ui/poster';
import { Title } from '@/components/videojs/ui/title';
import { cn } from '@/lib/resolve-class-name';

import { VideoGestures } from './behaviors/gestures';
import { VideoHotkeys } from './behaviors/hotkeys';
import { VideoStatusIndicators } from './display/status-indicators';
import { NeutralVideoControls } from './layout/controls';

export interface VideoSkinProps extends Omit<NonNullable<ComponentProps<typeof Container>>, 'children'> {
  children?: ReactNode;
  renderPoster?: NonNullable<ComponentProps<typeof Poster>>['renderImage'];
  renderThumbnail?: NonNullable<ComponentProps<typeof NeutralVideoControls>>['renderThumbnail'];
  onSeekDragStart?: () => void;
  onSeekDragEnd?: () => void;
  onSeekCommitStart?: () => void;
  onSeekBy?: (seconds: number) => void;
  serverAudioTracks?: NonNullable<ComponentProps<typeof NeutralVideoControls>>['serverAudioTracks'];
  selectedAudioIndex?: number;
  onSelectAudioTrack?: (index: number) => void;
  subtitleOffset?: number;
  onAdjustSubtitleOffset?: (delta: number) => void;
  onResetSubtitleOffset?: () => void;
  subtitlePosition?: number;
  onAdjustSubtitlePosition?: (delta: number) => void;
  onResetSubtitlePosition?: () => void;
}

export function VideoSkin({
  children,
  className,
  renderPoster,
  renderThumbnail,
  onSeekDragStart,
  onSeekDragEnd,
  onSeekCommitStart,
  onSeekBy,
  serverAudioTracks,
  selectedAudioIndex,
  onSelectAudioTrack,
  subtitleOffset,
  onAdjustSubtitleOffset,
  onResetSubtitleOffset,
  subtitlePosition,
  onAdjustSubtitlePosition,
  onResetSubtitlePosition,
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
      <ErrorDialog />
      <Title />

      <NeutralVideoControls
        renderThumbnail={renderThumbnail}
        onSeekDragStart={onSeekDragStart}
        onSeekDragEnd={onSeekDragEnd}
        onSeekCommitStart={onSeekCommitStart}
        onSeekBy={onSeekBy}
        serverAudioTracks={serverAudioTracks}
        selectedAudioIndex={selectedAudioIndex}
        onSelectAudioTrack={onSelectAudioTrack}
        subtitleOffset={subtitleOffset}
        onAdjustSubtitleOffset={onAdjustSubtitleOffset}
        onResetSubtitleOffset={onResetSubtitleOffset}
        subtitlePosition={subtitlePosition}
        onAdjustSubtitlePosition={onAdjustSubtitlePosition}
        onResetSubtitlePosition={onResetSubtitlePosition}
      />

      <VideoHotkeys />
      <VideoGestures />
      <VideoStatusIndicators />
    </Container>
  );
}
