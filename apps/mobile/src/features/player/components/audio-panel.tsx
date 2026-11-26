import { triggerHaptic } from "@/shared/lib/haptics";
import { CheckboxIndicator } from "@/shared/ui/checkbox-indicator";
import { X } from "@/shared/ui/icons";
import type { AudioTrack, SubtitleTrack, VideoPlayer } from "expo-video";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Playability } from "@/core/library/catalog-api";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import { subtitleLanguageName, subtitleTrackDisplay } from "@/features/player/lib/subtitles";

interface TrackRow {
  key: string;
  label: string;
  /** Optional language / Default line shown above the track name. */
  eyebrow?: string;
  selected: boolean;
  onPress: () => void;
}

function Row({ row }: { row: TrackRow }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: row.selected }}
      onPress={() => { triggerHaptic("selection"); row.onPress(); }}
      className={cn(
        "min-h-[52px] flex-row items-center justify-between rounded-[12px] px-4 py-2.5 active:bg-foreground/10",
        row.selected && "bg-foreground/[0.08]",
      )}
    >
      <View className="mr-3 flex-1">
        {row.eyebrow ? (
          <Text
            numberOfLines={1}
            className="mb-0.5 text-[10px] font-bold uppercase tracking-[1.1px] text-foreground/45"
          >
            {row.eyebrow}
          </Text>
        ) : null}
        <Text
          numberOfLines={row.eyebrow ? 2 : 1}
          className={cn(
            "text-[14px]",
            row.selected ? "font-bold text-foreground" : "text-foreground/85",
          )}
        >
          {row.label}
        </Text>
      </View>
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
  onSearchSubtitles,
  canRememberShow,
  showOverrideLabel,
  onClearShowOverride,
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
  onSearchSubtitles?: () => void;
  canRememberShow: boolean;
  showOverrideLabel?: string;
  onClearShowOverride: () => void;
  onPickAudio: (track: AudioTrack, remember: boolean) => void;
  onPickSubtitle: (value: string | null, remember: boolean) => void;
  onAddSubtitleFile: () => void;
}) {
  const colors = useColors();
  const [remember, setRemember] = useState(false);
  const pickSubtitle = (value: string | null) => {
    onPickSubtitle(value, remember);
    setRemember(false);
  };
  const selectedAudio =
    player.audioTrack ?? nativeAudio.find((track) => track.isDefault) ?? nativeAudio[0];
  const subtitleRows: TrackRow[] = [
    {
      key: "off",
      label: "Off",
      selected: !subtitle,
      onPress: () => pickSubtitle(null),
    },
    ...(serverTracks ?? []).map((track) => ({
      key: track.track,
      ...subtitleTrackDisplay({
        title: track.title,
        language: track.language,
        isDefault: track.isDefault,
      }),
      selected: subtitle === track.track,
      onPress: () => pickSubtitle(track.track),
    })),
    ...nativeSubtitles.map((track) => ({
      key: `native:${track.id}`,
      ...subtitleTrackDisplay({
        title: track.label,
        language: track.language,
        fallback: "Embedded subtitles",
      }),
      selected: subtitle === `native:${track.id}`,
      onPress: () => pickSubtitle(`native:${track.id}`),
    })),
  ];
  if (onSearchSubtitles) {
    subtitleRows.push({
      key: "search",
      label: "Find subtitles online",
      selected: false,
      onPress: () => {
        setRemember(false);
        onSearchSubtitles();
      },
    });
  }
  if (canAddSubtitleFile) {
    subtitleRows.push({
      key: "add",
      label: "Add subtitle file (SRT / VTT)",
      selected: false,
      onPress: () => {
        setRemember(false);
        onAddSubtitleFile();
      },
    });
  }
  const close = () => {
    setRemember(false);
    triggerHaptic("light");
    onClose();
  };
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
          className="w-[380px] max-w-[92vw] rounded-[18px] border border-foreground/10 bg-overlay p-2.5"
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
            {canRememberShow ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: remember }}
                accessibilityHint="Saves the language from your next track selection"
                onPress={() => {
                  triggerHaptic("selection");
                  setRemember((value) => !value);
                }}
                className={cn(
                  "min-h-[52px] flex-row items-center justify-between gap-3 rounded-[12px] px-4 active:bg-foreground/10",
                  remember && "bg-foreground/[0.08]",
                )}
              >
                <View className="flex-1">
                  <Text className="text-[14px] font-bold text-foreground">Remember for this show</Text>
                  <Text className="text-[12px] text-foreground/55">Save your next language choice</Text>
                </View>
                <CheckboxIndicator checked={remember} />
              </Pressable>
            ) : null}
            {showOverrideLabel ? (
              <Row row={{
                key: "app-defaults",
                label: "Use app defaults",
                eyebrow: showOverrideLabel,
                selected: false,
                onPress: () => {
                  setRemember(false);
                  onClearShowOverride();
                },
              }} />
            ) : null}
            <Section label="Audio" />
            {nativeAudio.length ? (
              nativeAudio.map((track) => (
                <Row
                  key={String(track.id ?? track.label ?? track.language)}
                  row={{
                    key: String(track.id ?? track.label ?? track.language),
                    label:
                      track.label ||
                      subtitleLanguageName(track.language) ||
                      track.id ||
                      "Audio track",
                    eyebrow:
                      track.label && track.language &&
                      track.label.toLowerCase() !== (subtitleLanguageName(track.language) ?? "").toLowerCase()
                        ? subtitleLanguageName(track.language) ?? undefined
                        : undefined,
                    selected: selectedAudio === track ||
                      (selectedAudio?.id != null && selectedAudio.id === track.id),
                    onPress: () => {
                      onPickAudio(track, remember);
                      setRemember(false);
                    },
                  }}
                />
              ))
            ) : (
              <Row
                row={{
                  key: "default-audio",
                  label: "Default audio track",
                  selected: true,
                  onPress: close,
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
