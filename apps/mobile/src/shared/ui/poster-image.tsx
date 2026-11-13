import { Image } from "expo-image";
import type { ImageStyle, StyleProp } from "react-native";

export function PosterImage({
  source,
  style,
  resizeMode = "cover",
}: {
  source: { uri: string; headers?: Record<string, string> } | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
}) {
  if (!source?.uri) return null;
  return (
    <Image
      source={source}
      style={[{ width: "100%", height: "100%" }, style]}
      contentFit={resizeMode}
      cachePolicy="memory-disk"
      recyclingKey={source.uri}
    />
  );
}
