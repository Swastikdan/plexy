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
const forwardCircle =
  "M12 5L13.1039 3.45459C13.5149 2.87911 13.7205 2.59137 13.5907 2.32411C13.4609 2.05684 13.1311 2.04153 12.4714 2.01092C12.3152 2.00367 12.158 2 12 2C6.4772 2 2 6.47715 2 12C2 17.5228 6.4772 22 12 22C17.5229 22 22 17.5228 22 12C22 8.72836 20.4289 5.82368 18 3.99927";
const backwardCircle =
  "M12 5L10.8961 3.45459C10.4851 2.87911 10.2795 2.59137 10.4093 2.32411C10.5391 2.05684 10.8689 2.04153 11.5286 2.01092C11.6848 2.00367 11.842 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 8.72836 3.57111 5.82368 6 3.99927";
const digitTwo =
  "M7.5 11.1C8.1 9.9 9.9 9.9 10.5 11.1C11.1 12.3 10.1 13.3 9.2 14.1L7.5 16H10.6";
const digitZero =
  "M16.0022 12.6C16.0022 11.22 16.0682 10.848 15.8042 10.404C15.5402 9.96001 14.8802 9.99841 14.2202 9.99841C13.5602 9.99841 13.0802 9.96001 12.7622 10.32C12.3722 10.74 12.5402 11.52 12.4922 12.6C12.6002 14.04 12.3062 15.18 12.7562 15.66C13.0802 16.056 13.6553 15.996 14.3402 16.008C15.0201 15.9997 15.4322 16.032 15.7682 15.648C16.1402 15.312 15.9602 13.98 16.0022 12.6Z";
function TwentySecondIcon({
  backward,
  size,
  color,
}: {
  backward: boolean;
  size: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={backward ? backwardCircle : forwardCircle}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d={digitTwo}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <Path
        d={digitZero}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}
type SeekIconProps = { size?: number; color?: string; seconds?: number };
export function IconSeekBack({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: SeekIconProps) {
  if (seconds === 20)
    return <TwentySecondIcon backward size={size} color={color} />;
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
  if (seconds === 20)
    return <TwentySecondIcon backward={false} size={size} color={color} />;
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
