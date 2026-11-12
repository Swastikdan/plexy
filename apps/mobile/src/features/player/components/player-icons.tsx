import { Text,View } from "react-native";
import { colors,fonts } from "../../../shared/theme";
import {
ArrowLeft as ArrowLeftIcon,
AudioLines,
Check as CheckIcon,
Crop,
Maximize,
MoveHorizontal,
Pause as PauseIcon,
PictureInPicture,
Play as PlayIcon,
RotateCcw,
RotateCw,
SkipForward,
SlidersHorizontal,
Subtitles as SubtitlesIcon,
X as XIcon,
ZoomIn,
} from "../../../shared/ui/icons";
import { SEEK_SECONDS } from "../lib/player-interactions";

export function IconBack({
  size = 24,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <ArrowLeftIcon size={size} color={color} strokeWidth={2.2} />;
}

export function IconPlay({
  size = 32,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <PlayIcon size={size} color={color} fill={color} />;
}

export function IconPause({
  size = 30,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <PauseIcon size={size} color={color} fill={color} />;
}

export function IconRewind({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: {
  size?: number;
  color?: string;
  seconds?: number;
}) {
  const containerSize = size + 16;
  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <RotateCcw size={size} color={color} strokeWidth={2.2} />
      <Text
        style={{
          position: "absolute",
          fontSize: 10,
          color,
          fontFamily: fonts.bold,
          textAlign: "center",
          top: Math.round(containerSize / 2) - 6,
        }}
      >
        {seconds}
      </Text>
    </View>
  );
}

export function IconForward({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: {
  size?: number;
  color?: string;
  seconds?: number;
}) {
  const containerSize = size + 16;
  return (
    <View
      style={{
        width: containerSize,
        height: containerSize,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <RotateCw size={size} color={color} strokeWidth={2.2} />
      <Text
        style={{
          position: "absolute",
          fontSize: 10,
          color,
          fontFamily: fonts.bold,
          textAlign: "center",
          top: Math.round(containerSize / 2) - 6,
        }}
      >
        {seconds}
      </Text>
    </View>
  );
}

export function IconPip({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <PictureInPicture size={size} color={color} strokeWidth={1.9} />;
}

export function IconAudio({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <AudioLines size={size} color={color} strokeWidth={2} />;
}

export function IconSubtitles({
  size = 22,
  color = "#fff",
  active = false,
}: {
  size?: number;
  color?: string;
  active?: boolean;
}) {
  return <SubtitlesIcon size={size} color={color} strokeWidth={2} />;
}

export function IconSettings({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <SlidersHorizontal size={size} color={color} strokeWidth={2} />;
}

export function IconFullscreen({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <Maximize size={size} color={color} strokeWidth={2} />;
}

export function IconFitState({
  mode,
  zoom,
  size = 20,
  color = "#fff",
}: {
  mode: "contain" | "cover" | "fill";
  zoom: number;
  size?: number;
  color?: string;
}) {
  if (mode === "cover") {
    return <Crop size={size} color={color} strokeWidth={2.2} />;
  }
  if (mode === "fill") {
    return <MoveHorizontal size={size} color={color} strokeWidth={2.2} />;
  }
  if (zoom === 1.05) {
    return (
      <View
        style={{
          width: size + 6,
          height: size + 6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ZoomIn size={size} color={color} strokeWidth={2} />
        <View
          style={{
            position: "absolute",
            bottom: -2,
            right: -4,
            backgroundColor: colors.brand,
            borderRadius: 4,
            paddingHorizontal: 2,
            paddingVertical: 0.5,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 7, fontFamily: fonts.bold }}>
            105
          </Text>
        </View>
      </View>
    );
  }
  if (zoom === 1.2 || zoom > 1) {
    return (
      <View
        style={{
          width: size + 6,
          height: size + 6,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ZoomIn size={size} color={color} strokeWidth={2} />
        <View
          style={{
            position: "absolute",
            bottom: -2,
            right: -4,
            backgroundColor: colors.brand,
            borderRadius: 4,
            paddingHorizontal: 2,
            paddingVertical: 0.5,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 7, fontFamily: fonts.bold }}>
            120
          </Text>
        </View>
      </View>
    );
  }
  return <Maximize size={size} color={color} strokeWidth={2.2} />;
}

export function IconClose({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <XIcon size={size} color={color} strokeWidth={2.2} />;
}

export function IconNext({
  size = 22,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return <SkipForward size={size} color={color} strokeWidth={2} />;
}

export function IconCheck({
  size = 20,
  color = "#ffffff",
}: {
  size?: number;
  color?: string;
}) {
  return <CheckIcon size={size} color={color} strokeWidth={2.5} />;
}
