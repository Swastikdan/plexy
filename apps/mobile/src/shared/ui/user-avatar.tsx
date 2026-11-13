import { useState } from "react";
import {
Image,
Text,
View,
type StyleProp,
type ViewStyle,
} from "react-native";
import { fonts, useColors } from "@/shared/theme";

export function dicebearAvatarUrl(seed: string): string {
  const clean = encodeURIComponent((seed || "user").trim());
  return `https://api.dicebear.com/9.x/bottts-neutral/png?seed=${clean}&size=128`;
}

export function UserAvatar({
  name,
  size = 32,
  style,
}: {
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [loadError, setLoadError] = useState(false);
  const initial = (name || "U").charAt(0).toUpperCase();
  const avatarUrl = dicebearAvatarUrl(name);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.elevated,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.line,
        },
        style,
      ]}
    >
      {!loadError ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
          onError={() => setLoadError(true)}
        />
      ) : (
        <Text
          style={{
            fontSize: Math.round(size * 0.42),
            fontWeight: "700",
            color: colors.ink,
            fontFamily: fonts.bold,
          }}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}
