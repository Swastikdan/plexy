import { useReducedMotion } from "react-native-reanimated";
import { Image } from "expo-image";
import type { ImageStyle, StyleProp } from "react-native";

export function PosterImage({
  source,
  style,
  resizeMode = "cover",
  onError,
}: {
  source: { uri: string; headers?: Record<string, string> } | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
  onError?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  if (!source?.uri) return null;
  return (
    <Image
      source={source}
      style={[{ width: "100%", height: "100%" }, style]}
      contentFit={resizeMode}
      transition={reducedMotion ? 0 : { duration: 120, timing: "ease-out", effect: "cross-dissolve" }}
      cachePolicy="memory-disk"
      recyclingKey={source.uri}
      onError={onError}
    />
  );
}
