import { View } from "react-native";
import { cn } from "@/shared/lib/cn";
import { Check } from "./icons";

export function CheckboxIndicator({ checked, onArtwork = false }: {
  checked: boolean;
  onArtwork?: boolean;
}) {
  return (
    <View
      accessible={false}
      className={cn(
        "h-[22px] w-[22px] items-center justify-center rounded-[5px] border",
        checked ? "border-accent bg-accent" : onArtwork ? "border-white/85 bg-black/50" : "border-muted",
      )}
    >
      {checked ? <Check size={14} color="#fff" strokeWidth={2.7} /> : null}
    </View>
  );
}
