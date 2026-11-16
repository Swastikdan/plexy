import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { useColors, withAlpha } from "@/shared/theme";
import { PosterImage } from "@/shared/ui/poster-image";

/**
 * Full-bleed key art for a title page. The backdrop runs edge to edge behind
 * the status bar, the logo (or wordmark) sits over its lower third, and the
 * image dissolves into the page canvas before the facts begin.
 */
export function TitleHero({
  item,
  logo,
}: {
  item: ItemCard;
  logo?: string | null;
}) {
  const { api } = useClient();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const artwork = item.backdrop || item.poster;
  const artworkHeight = Math.round(
    Math.min(Math.max(height * 0.46, 360), 520) + insets.top,
  );

  return (
    <View
      className="w-full overflow-hidden bg-surface"
      style={{ height: artworkHeight }}
    >
      {artwork ? (
        <PosterImage
          source={api.image(artwork)}
          style={StyleSheet.absoluteFill as never}
          resizeMode="cover"
        />
      ) : null}

      {/* Fade the art into the canvas so the centered facts below read as part
          of the page. The floating controls keep their own TopFade scrim. */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          withAlpha(colors.canvas, 0),
          withAlpha(colors.canvas, 0),
          withAlpha(colors.canvas, 0.35),
          colors.canvas,
        ]}
        locations={[0, 0.68, 0.9, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View className="absolute inset-x-5 bottom-7 items-center">
        {logo && failedLogo !== logo ? (
          <Image
            source={api.image(logo)}
            accessibilityLabel={item.name}
            style={{ width: "78%", height: 92 }}
            contentFit="contain"
            cachePolicy="memory-disk"
            onError={() => setFailedLogo(logo)}
          />
        ) : (
          <Text
            className="text-center font-archivo-black text-[34px] leading-[40px] tracking-[-0.6px] text-white"
            numberOfLines={2}
            selectable={false}
            style={{
              textShadowColor: "rgba(0,0,0,0.55)",
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 12,
            }}
          >
            {item.name}
          </Text>
        )}
      </View>
    </View>
  );
}
