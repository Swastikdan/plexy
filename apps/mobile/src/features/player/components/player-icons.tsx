import { Text, View } from "react-native";
import { Svg, Path, Rect } from "react-native-svg";
import { useColors } from "@/shared/theme";
import { Crop, Maximize, MoveHorizontal, ZoomIn } from "@/shared/ui/icons";
import { SEEK_SECONDS } from "@/features/player/lib/player-interactions";

/** Traditional seek-back button: two solid triangles pointing left with the
 * seek amount printed underneath. */
export function IconSeekBack({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: {
  size?: number;
  color?: string;
  seconds?: number;
}) {
  return (
    <View className="items-center justify-center" style={{ width: size + 10 }}>
      <Svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 30 21">
        <Path d="M14 1.5 L2.5 10.5 L14 19.5 Z" fill={color} />
        <Path d="M29 1.5 L17.5 10.5 L29 19.5 Z" fill={color} />
      </Svg>
      <Text
        className="text-[10px] font-archivo-bold"
        style={{ color, marginTop: 1 }}
      >
        {seconds}
      </Text>
    </View>
  );
}

/** Traditional seek-forward button: two solid triangles pointing right with
 * the seek amount printed underneath. */
export function IconSeekForward({
  size = 30,
  color = "#fff",
  seconds = SEEK_SECONDS,
}: {
  size?: number;
  color?: string;
  seconds?: number;
}) {
  return (
    <View className="items-center justify-center" style={{ width: size + 10 }}>
      <Svg width={size} height={Math.round(size * 0.7)} viewBox="0 0 30 21">
        <Path d="M16 1.5 L27.5 10.5 L16 19.5 Z" fill={color} />
        <Path d="M1 1.5 L12.5 10.5 L1 19.5 Z" fill={color} />
      </Svg>
      <Text
        className="text-[10px] font-archivo-bold"
        style={{ color, marginTop: 1 }}
      >
        {seconds}
      </Text>
    </View>
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
