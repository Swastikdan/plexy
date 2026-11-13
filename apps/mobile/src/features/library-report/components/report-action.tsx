import { Pressable,Text } from "react-native";
import { cn } from "@/shared/lib/cn";

export function ReportAction({
  label,
  onPress,
  disabled = false,
  subtle = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  subtle?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "min-h-[40px] min-w-[84px] items-center justify-center rounded-full px-5 py-2",
        subtle ? "bg-surface-secondary" : "bg-accent",
        "disabled:opacity-45 active:opacity-70",
      )}
    >
      <Text className={cn("text-[13px] font-archivo-medium", subtle ? "text-foreground" : "text-white")}>
        {label}
      </Text>
    </Pressable>
  );
}
