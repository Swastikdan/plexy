import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { LIST_ITEM_EXIT, LIST_LAYOUT } from "@/shared/ui/list-motion";
import { useClient } from "@/core/client/client-provider";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import { Film } from "@/shared/ui/icons";
import { PosterImage } from "@/shared/ui/poster-image";
import { triggerHaptic } from "@/shared/lib/haptics";

export function HiddenTitlesSettings() {
  const colors = useColors();
  const { api } = useClient();
  const { hidden, restore, restoreAll } = useHiddenTitles();

  if (!hidden.length) {
    return (
      <View className="flex-1 items-center justify-center gap-2 px-6 py-12">
        <Text className="text-center text-[18px] font-archivo-bold text-foreground">
          No hidden titles
        </Text>
        <Text className="text-center text-[14px] leading-5 font-archivo-regular text-muted">
          To hide a title, choose “Remove this title” from its menu.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className="overflow-hidden rounded-[18px] bg-surface">
        {hidden.map((entry) => (
          <Animated.View
            key={entry.publicId}
            layout={LIST_LAYOUT}
            exiting={LIST_ITEM_EXIT}
            className="min-h-[82px] flex-row items-center gap-3 border-b-[0.33px] border-border px-4 py-3"
          >
            <View className="h-[58px] w-[40px] overflow-hidden rounded-[7px] bg-surface-secondary">
              {entry.poster ? (
                <PosterImage source={api.image(entry.poster)} />
              ) : (
                <View className="h-full w-full items-center justify-center">
                  <Film size={18} color={colors.muted} />
                </View>
              )}
            </View>
            <View className="flex-1 gap-1">
              <Text
                numberOfLines={2}
                className="font-archivo-medium text-[15px] text-foreground"
              >
                {entry.name}
              </Text>
              <Text className="font-archivo-regular text-[12px] text-muted">
                {[entry.year, entry.kind === "series" ? "TV" : "Movie"]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Button
              label="Restore"
              className="min-h-10 px-3.5 py-2"
              onPress={() => {
                triggerHaptic("light");
                void restore(entry.publicId);
              }}
            />
          </Animated.View>
        ))}
      </View>
      <Button
        label={`Restore all ${hidden.length === 1 ? "title" : "titles"}`}
        onPress={() => {
          triggerHaptic("medium");
          void restoreAll();
        }}
        className="self-start"
      />
    </View>
  );
}
