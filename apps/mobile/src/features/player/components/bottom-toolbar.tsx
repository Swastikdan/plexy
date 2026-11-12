import React from "react";
import { Pressable,Text,View } from "react-native";
import { AudioLines,Gauge,ListVideo,Lock } from "@/shared/ui/icons";
import { IconSkipEnd } from "./player-icons";

function ToolButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-full px-4 py-2.5 active:bg-white/10"
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      {icon}
      <Text
        numberOfLines={1}
        className="text-[14px] font-archivo-medium text-white"
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Bottom row of the landscape player: Speed, Lock, Episodes,
 * Audio & Subtitles, Next Episode — sitting just under the seek bar. */
export function BottomToolbar({
  speed,
  bottom,
  onSpeed,
  onLock,
  showEpisodes,
  onEpisodes,
  onAudioSubtitles,
  showNext,
  onNext,
}: {
  speed: number;
  bottom: number;
  onSpeed: () => void;
  onLock: () => void;
  showEpisodes: boolean;
  onEpisodes: () => void;
  onAudioSubtitles: () => void;
  showNext: boolean;
  onNext: () => void;
}) {
  return (
    <View
      className="absolute left-4 right-4 flex-row items-center justify-center gap-3"
      style={{ bottom }}
      pointerEvents="box-none"
    >
      <ToolButton
        icon={<Gauge size={20} color="#ffffff" />}
        label={`Speed (${speed}×)`}
        onPress={onSpeed}
      />
      <ToolButton
        icon={<Lock size={19} color="#ffffff" />}
        label="Lock"
        onPress={onLock}
      />
      {showEpisodes && (
        <ToolButton
          icon={<ListVideo size={20} color="#ffffff" />}
          label="Episodes"
          onPress={onEpisodes}
        />
      )}
      <ToolButton
        icon={<AudioLines size={20} color="#ffffff" />}
        label="Audio & Subtitles"
        onPress={onAudioSubtitles}
      />
      {showNext && (
        <ToolButton
          icon={<IconSkipEnd size={21} color="#ffffff" />}
          label="Next Ep."
          onPress={onNext}
        />
      )}
    </View>
  );
}
