import React from "react";
import { Pressable,Text,View } from "react-native";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";
import { colors } from "@/shared/theme";
import { Icon } from "@/shared/ui/icon";

export function SettingsRow({
  title,
  subtitle,
  icon,
  onPress,
  children,
  danger,
}: {
  title: string;
  subtitle?: string;
  icon?: "library" | "settings" | "film" | "tv" | "download";
  onPress?: () => void;
  children?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={() => {
        if (onPress) triggerHaptic("light");
        onPress?.();
      }}
      disabled={!onPress}
      className="min-h-[66px] flex-row items-center gap-3.5 border-b-[0.33px] border-border px-4 py-3.5 active:bg-surface-hover"
    >
      {icon && (
        <View className="w-6 items-center">
          <Icon name={icon} size={20} color={colors.muted} />
        </View>
      )}
      <View className="flex-1 gap-1">
        <Text
          className={cn(
            "text-[15px] font-archivo-medium",
            danger ? "text-danger" : "text-foreground",
          )}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
            {subtitle}
          </Text>
        )}
      </View>
      {children ||
        (onPress && <Text className="text-[22px] text-muted">›</Text>)}
    </Pressable>
  );
}
