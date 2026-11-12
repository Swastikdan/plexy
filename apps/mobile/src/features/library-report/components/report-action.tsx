import { Pressable,Text } from "react-native";
import { cn } from "../../../shared/lib/cn";

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
        "min-h-[44px] items-center justify-center rounded-full px-4 py-3",
        subtle ? "bg-surface-secondary" : "bg-accent",
        "disabled:opacity-45 active:opacity-70",
      )}
    >
      <Text className="text-[13px] font-archivo-medium text-foreground">
        {label}
      </Text>
    </Pressable>
  );
}
