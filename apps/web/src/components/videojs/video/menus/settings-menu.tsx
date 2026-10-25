import type { ComponentProps } from 'react';

import { AudioTrackMenu, type ServerAudioTrack } from '@/components/videojs/ui/audio-track-menu';
import { CaptionsSubmenu } from '@/components/videojs/ui/captions-submenu';
import { PlaybackRateSubmenu } from '@/components/videojs/ui/playback-rate-submenu';
import { QualityMenu } from '@/components/videojs/ui/quality-menu';
import { SettingsMenu } from '@/components/videojs/ui/settings-menu';
import { SubtitlePositionSubmenu } from '@/components/videojs/ui/subtitle-position-submenu';
import { SubtitleSyncSubmenu } from '@/components/videojs/ui/subtitle-sync-submenu';

export interface VideoSettingsMenuProps
  extends Omit<NonNullable<ComponentProps<typeof SettingsMenu>>, 'children'> {
  serverAudioTracks?: ServerAudioTrack[];
  selectedAudioIndex?: number;
  onSelectAudioTrack?: (index: number) => void;
  subtitleOffset?: number;
  onAdjustSubtitleOffset?: (delta: number) => void;
  onResetSubtitleOffset?: () => void;
  subtitlePosition?: number;
  onAdjustSubtitlePosition?: (delta: number) => void;
  onResetSubtitlePosition?: () => void;
}

export function VideoSettingsMenu({
  serverAudioTracks,
  selectedAudioIndex,
  onSelectAudioTrack,
  subtitleOffset = 0,
  onAdjustSubtitleOffset,
  onResetSubtitleOffset,
  subtitlePosition = 0,
  onAdjustSubtitlePosition,
  onResetSubtitlePosition,
  ...props
}: VideoSettingsMenuProps = {}) {
  return (
    <SettingsMenu {...props}>
      <QualityMenu />
      <AudioTrackMenu
        serverTracks={serverAudioTracks}
        selectedServerTrackIndex={selectedAudioIndex}
        onSelectServerTrack={onSelectAudioTrack}
      />
      <PlaybackRateSubmenu />
      <CaptionsSubmenu />
      {onAdjustSubtitleOffset && onResetSubtitleOffset && (
        <SubtitleSyncSubmenu
          offset={subtitleOffset}
          onAdjustOffset={onAdjustSubtitleOffset}
          onResetOffset={onResetSubtitleOffset}
        />
      )}
      {onAdjustSubtitlePosition && onResetSubtitlePosition && (
        <SubtitlePositionSubmenu
          position={subtitlePosition}
          onAdjustPosition={onAdjustSubtitlePosition}
          onResetPosition={onResetSubtitlePosition}
        />
      )}
    </SettingsMenu>
  );
}
