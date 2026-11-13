import { triggerHaptic } from "@/shared/lib/haptics";
import { Check, X } from "@/shared/ui/icons";
import type { AudioTrack, SubtitleTrack, VideoPlayer } from "expo-video";
import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Playability } from "@/core/library/catalog-api";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";

interface TrackRow {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}

function Row({ row }: { row: TrackRow }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: row.selected }}
      onPress={() => { triggerHaptic("selection"); row.onPress(); }}
      className={cn(
        "min-h-[48px] flex-row items-center justify-between rounded-[12px] px-4 py-3 active:bg-foreground/10",
        row.selected && "bg-foreground/[0.08]",
      )}
    >
      <Text
        numberOfLines={1}
        className={cn(
          "mr-3 flex-1 text-[14px]",
          row.selected ? "font-bold text-foreground" : "text-foreground/85",
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
    <Text className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[1.2px] text-foreground/[0.42]">
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
  const colors = useColors();
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
  const close = () => { triggerHaptic("light"); onClose(); };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={["landscape"]}
    >
      <View className="flex-1 items-center justify-center bg-black/55 p-4">
        <Pressable
          className="absolute inset-0"
          accessibilityLabel="Close audio and subtitles"
          onPress={close}
        />
        <View
          className="w-[330px] rounded-[18px] border border-foreground/10 bg-overlay p-2.5"
          style={{
            maxHeight: "100%",
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 20,
          }}
        >
          <View className="flex-row items-center justify-between pl-3">
            <Text className="text-[14px] font-bold text-foreground">Audio & Subtitles</Text>
            <Pressable onPress={close} hitSlop={4} accessibilityRole="button"
              accessibilityLabel="Close audio and subtitles"
              className="h-12 w-12 items-center justify-center rounded-full active:bg-foreground/10">
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>
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
