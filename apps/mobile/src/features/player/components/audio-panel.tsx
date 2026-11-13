import { Check } from "@/shared/ui/icons";
import type { AudioTrack, SubtitleTrack, VideoPlayer } from "expo-video";
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Playability } from "@/core/library/catalog-api";
import { colors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";

interface TrackRow {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Row({ row }: { row: TrackRow }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: row.selected }}
      onPress={row.onPress}
      className={cn(
        "flex-row items-center justify-between rounded-[12px] px-4 py-3 active:bg-white/10",
        row.selected && "bg-white/[0.08]",
      )}
    >
      <Text
        numberOfLines={1}
        className={cn(
          "mr-3 flex-1 text-[14px]",
          row.selected ? "font-bold text-white" : "text-white/85",
        )}
      >
        {row.label}
      </Text>
      {row.selected && (
        <Check strokeWidth={2.5} size={15} color={colors.brand} />
      )}
    </Pressable>
  );
}

function Section({ label }: { label: string }) {
  return (
    <Text className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[1.2px] text-white/[0.42]">
      {label}
    </Text>
  );
}

/** Compact Audio & Subtitles picker shown in the middle of the player. */
export function AudioPanel({
  visible,
  onClose,
  player,
  nativeAudio,
  subtitle,
  serverTracks,
  nativeSubtitles,
  canAddSubtitleFile,
  onPickAudio,
  onPickSubtitle,
  onAddSubtitleFile,
}: {
  visible: boolean;
  onClose: () => void;
  player: VideoPlayer;
  nativeAudio: AudioTrack[];
  subtitle: string | null;
  serverTracks: Playability["tracks"];
  nativeSubtitles: SubtitleTrack[];
  canAddSubtitleFile: boolean;
  onPickAudio: (track: AudioTrack) => void;
  onPickSubtitle: (value: string | null) => void;
  onAddSubtitleFile: () => void;
}) {
  const subtitleRows: TrackRow[] = [
    {
      key: "off",
      label: "Off",
      selected: !subtitle,
      onPress: () => onPickSubtitle(null),
    },
    ...(serverTracks ?? []).map((track) => ({
      key: track.track,
      label: track.title || track.language || track.track || "Subtitle track",
      selected: subtitle === track.track,
      onPress: () => onPickSubtitle(track.track),
    })),
    ...nativeSubtitles.map((track) => ({
      key: `native:${track.id}`,
      label: track.label || track.language || "Embedded subtitles",
      selected: subtitle === `native:${track.id}`,
      onPress: () => onPickSubtitle(`native:${track.id}`),
    })),
  ];
  if (canAddSubtitleFile) {
    subtitleRows.push({
      key: "add",
      label: "Add subtitle file (SRT / VTT)",
      selected: false,
      onPress: onAddSubtitleFile,
    });
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["landscape"]}
    >
      <View className="flex-1 bg-black/55">
        <Pressable
          className="absolute inset-0"
          accessibilityLabel="Close audio and subtitles"
          onPress={onClose}
        />
        <View
          className="absolute w-[330px] rounded-[18px] border border-white/10 bg-[#0d0e12] p-2.5"
          style={{
            left: "50%",
            top: "50%",
            transform: [{ translateX: -165 }, { translateY: -150 }],
            maxHeight: 320,
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 20,
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Section label="Audio" />
            {nativeAudio.length ? (
              nativeAudio.map((track, index) => (
                <Row
                  key={String(track.id ?? track.label ?? track.language)}
                  row={{
                    key: String(track.id ?? track.label ?? track.language),
                    label:
                      track.label ||
                      track.language ||
                      track.id ||
                      "Audio track",
                    // With no explicit selection the first track is the
                    // default — highlight it just like subtitles.
                    selected: player.audioTrack
                      ? player.audioTrack?.id === track.id
                      : index === 0,
                    onPress: () => onPickAudio(track),
                  }}
                />
              ))
            ) : (
              <Row
                row={{
                  key: "default-audio",
                  label: "Default audio track",
                  selected: true,
                  onPress: onClose,
                }}
              />
            )}
            <Section label="Subtitles" />
            {subtitleRows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
