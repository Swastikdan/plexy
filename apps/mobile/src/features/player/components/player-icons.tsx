import { HugeiconsIcon } from "@hugeicons/react-native";
import GoForward5SecIcon from "@hugeicons/core-free-icons/GoForward5SecIcon";
import GoForward10SecIcon from "@hugeicons/core-free-icons/GoForward10SecIcon";
import GoForward15SecIcon from "@hugeicons/core-free-icons/GoForward15SecIcon";
import GoForward30SecIcon from "@hugeicons/core-free-icons/GoForward30SecIcon";
import GoForward60SecIcon from "@hugeicons/core-free-icons/GoForward60SecIcon";
import GoBackward5SecIcon from "@hugeicons/core-free-icons/GoBackward5SecIcon";
import GoBackward10SecIcon from "@hugeicons/core-free-icons/GoBackward10SecIcon";
import GoBackward15SecIcon from "@hugeicons/core-free-icons/GoBackward15SecIcon";
import GoBackward30SecIcon from "@hugeicons/core-free-icons/GoBackward30SecIcon";
import GoBackward60SecIcon from "@hugeicons/core-free-icons/GoBackward60SecIcon";
import { Text, View } from "react-native";
import { Svg, Path, Rect } from "react-native-svg";
import { useColors } from "@/shared/theme";
import { Crop, Maximize, MoveHorizontal, ZoomIn } from "@/shared/ui/icons";
import { SEEK_SECONDS } from "@/features/player/lib/player-interactions";

const forwardIcons = {
  5: GoForward5SecIcon,
  10: GoForward10SecIcon,
  15: GoForward15SecIcon,
  30: GoForward30SecIcon,
  60: GoForward60SecIcon,
};
const backwardIcons = {
  5: GoBackward5SecIcon,
  10: GoBackward10SecIcon,
  15: GoBackward15SecIcon,
  30: GoBackward30SecIcon,
  60: GoBackward60SecIcon,
};
type SeekIconProps = { size?: number; color?: string; seconds?: number };
export function IconSeekBack({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: SeekIconProps) {
  return (
    <HugeiconsIcon
      icon={
        backwardIcons[seconds as keyof typeof backwardIcons] ??
        backwardIcons[10]
      }
      size={size}
      color={color}
    />
  );
}
export function IconSeekForward({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: SeekIconProps) {
  return (
    <HugeiconsIcon
      icon={
        forwardIcons[seconds as keyof typeof forwardIcons] ?? forwardIcons[10]
      }
      size={size}
      color={color}
    />
  );
}

/** Skip-to-next icon: solid triangle against a stop bar. */
export function IconSkipEnd({
  size = 20,
  color = "#fff",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <View className="items-center justify-center" style={{ width: size }}>
      <Svg width={size} height={Math.round(size * 0.83)} viewBox="0 0 24 20">
        <Path d="M3 1.5 L17 10 L3 18.5 Z" fill={color} />
        <Rect x="19.5" y="1.5" width="3" height="17" rx="1.2" fill={color} />
      </Svg>
    </View>
  );
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
  const colors = useColors();
  if (mode === "cover") {
    return <Crop size={size} color={color} strokeWidth={2.2} />;
  }
  if (mode === "fill") {
    return <MoveHorizontal size={size} color={color} strokeWidth={2.2} />;
  }
  if (zoom === 1.05) {
    return (
      <View
        className="items-center justify-center"
        style={{ width: size + 6, height: size + 6 }}
      >
        <ZoomIn size={size} color={color} strokeWidth={2} />
        <View
          className="absolute rounded-[4px] px-0.5 py-[0.5px] -bottom-0.5 -right-1"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-white text-[7px] font-archivo-bold">105</Text>
        </View>
      </View>
    );
  }
  if (zoom === 1.2 || zoom > 1) {
    return (
      <View
        className="items-center justify-center"
        style={{ width: size + 6, height: size + 6 }}
      >
        <ZoomIn size={size} color={color} strokeWidth={2} />
        <View
          className="absolute rounded-[4px] px-0.5 py-[0.5px] -bottom-0.5 -right-1"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-white text-[7px] font-archivo-bold">120</Text>
        </View>
      </View>
    );
  }
  return <Maximize size={size} color={color} strokeWidth={2.2} />;
}
