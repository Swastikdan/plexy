import React from "react";
import { Pressable, Text, View } from "react-native";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { Check, ChevronRight, type NativeIcon } from "@/shared/ui/icons";

export function SettingsRow({
  title,
  subtitle,
  icon: Icon,
  onPress,
  children,
  danger,
  navigation = false,
  selected,
}: {
  title: string;
  subtitle?: string;
  icon?: NativeIcon;
  onPress?: () => void;
  children?: React.ReactNode;
  danger?: boolean;
  navigation?: boolean;
  selected?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole={
        selected !== undefined ? "radio" : onPress ? "button" : undefined
      }
      accessibilityState={
        selected !== undefined ? { checked: selected } : undefined
      }
      onPress={() => {
        if (onPress) triggerHaptic("light");
        onPress?.();
      }}
      disabled={!onPress}
      className={cn(
        "min-h-[66px] flex-row items-center gap-3.5 border-b-[0.33px] border-border px-4 py-3.5 active:bg-surface-hover",
        selected && "bg-accent/15",
      )}
    >
      {Icon && (
        <View className="w-6 items-center">
          <Icon size={20} color={colors.muted} />
        </View>
      )}
      <View className="flex-1 gap-1">
        <Text
          className={cn(
            "text-[15px] font-archivo-medium",
            danger
              ? "text-danger"
              : onPress && !navigation && selected === undefined && !children
                ? "text-accent"
                : "text-foreground",
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
        (selected ? (
          <Check size={22} color={colors.brand} />
        ) : navigation ? (
          <ChevronRight size={20} color={colors.muted} />
        ) : null)}
    </Pressable>
  );
}
