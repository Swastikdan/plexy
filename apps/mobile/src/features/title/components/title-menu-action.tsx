import { Pressable,Text } from "react-native";
import { cn } from "@/shared/lib/cn";
import { colors } from "@/shared/theme";
import type { NativeIcon } from "@/shared/ui/icons";
export function TitleMenuAction({
  label,
  icon: Icon,
  onPress,
  destructive = false,
}: {
  label: string;
  icon: NativeIcon;
  onPress: () => void;
  destructive?: boolean;
}) {
  const color = destructive ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-12 flex-row items-center gap-3 rounded-full bg-transparent px-3 active:bg-surface-hover"
    >
      <Icon size={20} color={color} />
      <Text
        className={cn(
          "font-archivo-medium text-[15px]",
          destructive ? "text-danger" : "text-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
