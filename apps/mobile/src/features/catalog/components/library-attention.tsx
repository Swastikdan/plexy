import { useRouter,useSegments } from "expo-router";
import { useEffect,useState } from "react";
import { Pressable,Text,View } from "react-native";
import { localRuntime } from "../../../core/library/local-runtime";
import { Icon } from "../../../shared/ui/icon";
export function LibraryAttention() {
  const router = useRouter();
  const segments = useSegments();
  const [attention, setAttention] = useState({ count: 0, fingerprint: "" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const update = () =>
      setAttention({
        count: localRuntime.getAttentionCount?.() ?? 0,
        fingerprint: localRuntime.getAttentionFingerprint?.() ?? "",
      });
    update();
    return localRuntime.subscribe?.(update);
  }, []);
  if (
    !attention.count ||
    attention.fingerprint === dismissed ||
    segments.includes("settings")
  )
    return null;
  return (
    <View className="flex-row items-center gap-3 bg-[#30230d] p-[14px]">
      <Text className="flex-1 text-[#fef3c7]">
        {attention.count} title{attention.count === 1 ? "" : "s"} need attention
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate("/settings")}
      >
        <Text className="text-[#f59e0b]">Review</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss notice"
        hitSlop={10}
        onPress={() => setDismissed(attention.fingerprint)}
      >
        <Icon name="close" color="#fff" size={16} />
      </Pressable>
    </View>
  );
}
