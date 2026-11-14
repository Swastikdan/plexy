import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { useRouter,useSegments } from "expo-router";
import { useEffect,useState } from "react";
import { Pressable,Text,View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import { X } from "@/shared/ui/icons";
export function LibraryAttention() {
  const colors = useColors();
  const { push } = useRouter();
  const segments = useSegments();
  const { runtime } = useClient();
  const [attention, setAttention] = useState({ count: 0, fingerprint: "" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const update = () =>
      setAttention({
        count: runtime.getAttentionCount(),
        fingerprint: runtime.getAttentionFingerprint(),
      });
    update();
    return runtime.subscribe(update);
  }, [runtime]);
  if (
    !attention.count ||
    attention.fingerprint === dismissed ||
    segments.includes("settings")
  )
    return null;
  return (
    <View className="flex-row items-center gap-3 bg-warning/15 px-[14px] py-1">
      <Pressable
        className="min-h-[48px] flex-1 flex-row items-center gap-3"
        accessibilityRole="button"
        accessibilityLabel={`${attention.count} titles need attention. Open library report`}
        onPress={() => { triggerHaptic("light"); push("/settings/report"); }}
      >
        <Text className="flex-1 text-foreground">
          {attention.count} title{attention.count === 1 ? "" : "s"} need attention
        </Text>
        <Text className="text-foreground">Review</Text>
      </Pressable>
      <Pressable
        className="h-12 w-12 items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="Dismiss notice"
        onPress={() => { triggerHaptic("light"); setDismissed(attention.fingerprint); }}
      >
        <X color={colors.ink} size={18} />
      </Pressable>
    </View>
  );
}
