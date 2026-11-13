import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { Check } from "@/shared/ui/icons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { cn } from "@/shared/lib/cn";

export function SheetItem({
  label,
  hint,
  selected,
  onPress,
  preferred,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onPress: () => void;
  preferred?: boolean;
}) {
  const colors = useColors();
  const [, setFocused] = useState(false);
  return (
    <Pressable
      focusable={true}
      onPress={() => { triggerHaptic("selection"); onPress(); }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      className={cn(
        "flex-row items-center justify-between px-5 py-4 border-b-[0.33px] border-border active:opacity-[0.75]",
        selected && "bg-foreground/[0.06]",
      )}
    >
      <Text
        className={cn(
          "flex-1 mr-2 text-[15px]",
          selected ? "text-foreground font-bold" : "text-foreground/85",
        )}
        numberOfLines={1}
      >
        {label}
      </Text>
      {!!hint && (
        <Text
          className="text-foreground/45 text-[13px] font-medium mr-2.5"
          numberOfLines={1}
        >
          {hint}
        </Text>
      )}
      {selected ? (
        <View className="w-6 h-6 rounded-[12px] bg-foreground items-center justify-center">
          <Check strokeWidth={2.5} size={15} color={colors.canvas} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function SheetSection({ label }: { label: string }) {
  return (
    <View className="px-5 pt-[22px] pb-1">
      <Text className="text-foreground/[0.42] text-[11px] font-bold uppercase tracking-[1.2px]">
        {label}
      </Text>
    </View>
  );
}

type SheetChipOption = {
  key: string;
  label: string;
  active?: boolean;
  onPress: () => void;
};

export function SheetChips({
  label,
  options,
}: {
  label: string;
  options: SheetChipOption[];
}) {
  return (
    <View className="px-5 pt-3.5 gap-2.5">
      <Text className="text-foreground text-[14px] font-semibold">{label}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        {options.map((option) => (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: !!option.active }}
            onPress={() => { triggerHaptic("selection"); option.onPress(); }}
            className={cn(
              "h-12 min-w-[64px] shrink-0 items-center justify-center rounded-full border px-3 active:opacity-[0.72]",
              option.active
                ? "bg-foreground border-foreground"
                : "bg-foreground/[0.08] border-foreground/10",
            )}
          >
            <Text
              className={cn(
                "text-[13px] font-semibold",
                option.active ? "text-background" : "text-foreground/[0.78]",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
