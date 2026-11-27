import { Pressable, Text, View } from "react-native";
import { Tappable } from "@/shared/ui/tappable";
import { cn } from "@/shared/lib/cn";
import { LONG_PRESS_MS } from "@/shared/lib/press";
import { useColors } from "@/shared/theme";
import { PosterImage } from "@/shared/ui/poster-image";
import { CheckboxIndicator } from "@/shared/ui/checkbox-indicator";
import { Eye, Globe, Play } from "@/shared/ui/icons";
import {
  DownloadButton,
  type DownloadButtonState,
} from "@/features/movy/components/download-button";

export interface EpisodeArtwork {
  uri: string;
  headers?: Record<string, string>;
}

/**
 * The episode row shared by local and online title screens. Callers only
 * supply display values; both catalogs get the same artwork, play glyph,
 * progress line and spacing.
 */
export function EpisodeCardView({
  artwork,
  title,
  overview,
  episodeNumber,
  duration,
  progress,
  watched = false,
  selecting = false,
  selected = false,
  disabled = false,
  onPress,
  onLongPress,
  onToggleWatched,
  accessibilityLabel,
  online = false,
  downloadState,
  downloadProgress,
  onDownload,
}: {
  artwork?: EpisodeArtwork;
  title: string;
  overview?: string | null;
  episodeNumber?: number | null;
  duration?: string | null;
  progress?: number | null;
  watched?: boolean;
  selecting?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onToggleWatched?: () => void;
  accessibilityLabel?: string;
  online?: boolean;
  downloadState?: DownloadButtonState;
  downloadProgress?: number;
  onDownload?: () => void;
}) {
  const colors = useColors();
  return (
    <Tappable
      feedback="scale"
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      disabled={disabled}
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected, disabled } : { disabled }}
      accessibilityLabel={
        accessibilityLabel ??
        `${title}${watched ? ", watched" : ""}${selecting ? (selected ? ", selected" : ", not selected") : ""}`
      }
      className={cn(
        "flex-row gap-[14px] rounded-[10px] px-2 py-3",
        selecting && selected && "bg-foreground/[0.08]",
      )}
    >
      <View className="aspect-[16/9] w-[148px] shrink-0 overflow-hidden rounded-lg bg-surface">
        {artwork?.uri ? (
          <PosterImage source={artwork} />
        ) : (
          <View className="h-full w-full bg-surface-secondary" />
        )}
        {!selecting && (
          <View className="absolute left-1/2 top-1/2 -ml-[22px] -mt-[22px] h-[44px] w-[44px] items-center justify-center rounded-full bg-white">
            <Play size={24} color={"#000"} fill={"#000"} />
          </View>
        )}
        {selecting && (
          <View className="absolute right-2 top-2" pointerEvents="none">
            <CheckboxIndicator checked={selected} onArtwork />
          </View>
        )}
        {duration && !selecting && (
          <View className="absolute right-1.5 top-1.5 rounded-[5px] bg-black/[0.65] px-1.5 py-0.5">
            <Text className="font-archivo-medium text-[10px] text-white">
              {duration}
            </Text>
          </View>
        )}
        {online && !selecting && (
          <View
            accessibilityLabel="Online episode"
            className="absolute left-1.5 top-1.5 h-[22px] w-[22px] items-center justify-center rounded-full bg-accent"
          >
            <Globe size={13} color="#fff" strokeWidth={2.1} />
          </View>
        )}
        {(progress !== null || watched) && (
          <View className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/[0.18]">
            <View
              className={cn(
                "h-full rounded-[2px] bg-accent",
                watched && "w-full",
              )}
              style={
                watched
                  ? undefined
                  : { width: `${Math.round((progress ?? 0) * 100)}%` }
              }
            />
          </View>
        )}
      </View>
      <View className="flex-1 justify-center gap-1.5">
        <View className="flex-row items-start justify-between gap-2">
          <Text
            className="flex-1 font-archivo-bold text-[14px] text-foreground"
            numberOfLines={1}
          >
            {title}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {onDownload && !selecting ? (
              <DownloadButton
                state={downloadState ?? "idle"}
                progress={downloadProgress}
                size={30}
                onPress={onDownload}
              />
            ) : null}
            {onToggleWatched && !selecting && (
              <Pressable
                onPress={onToggleWatched}
                hitSlop={10}
                className={cn(
                  "items-center justify-center rounded-full border border-border bg-surface p-1.5 active:opacity-70",
                  watched && "border-accent/40 bg-accent/15",
                )}
                accessibilityRole="button"
                accessibilityState={{ selected: watched }}
                accessibilityLabel={
                  watched
                    ? "Mark episode as unwatched"
                    : "Mark episode as watched"
                }
              >
                <Eye
                  size={14}
                  color={watched ? colors.brand : colors.muted}
                  strokeWidth={watched ? 2.6 : 2}
                />
              </Pressable>
            )}
          </View>
        </View>

        <Text
          className="font-archivo-regular text-[12px] leading-[18px] text-muted"
          numberOfLines={2}
        >
          {overview || "No description available."}
        </Text>
        {episodeNumber != null && (
          <Text className="mt-1 font-archivo-medium text-[11px] text-muted">
            {`Episode ${episodeNumber}`}
          </Text>
        )}
      </View>
    </Tappable>
  );
}
