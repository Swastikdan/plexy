import React from "react";
import { Text, View } from "react-native";
import { Tappable } from "@/shared/ui/tappable";
import { cn } from "@/shared/lib/cn";
import { useColors } from "@/shared/theme";
import { Check, ChevronRight, type NativeIcon } from "@/shared/ui/icons";

export function SettingsRow({
  title,
  subtitle,
  value,
  icon: Icon,
  onPress,
  children,
  danger,
  navigation = false,
  selected,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: NativeIcon;
  onPress?: () => void;
  children?: React.ReactNode;
  danger?: boolean;
  navigation?: boolean;
  selected?: boolean;
}) {
  const colors = useColors();
  return (
    <Tappable
      feedback="highlight"
      haptic={onPress ? "light" : undefined}
      accessibilityRole={
        selected !== undefined ? "radio" : onPress ? "button" : undefined
      }
      accessibilityState={
        selected !== undefined ? { checked: selected } : undefined
      }
      onPress={onPress}
      disabled={!onPress}
      className={cn(
        "min-h-[66px] flex-row items-center gap-3.5 border-b-[0.33px] border-border px-4 py-3.5",
        selected && "bg-foreground/[0.08]",
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
            "text-[15px]",
            danger ? "text-danger" : "text-foreground",
            selected ? "font-archivo-bold" : "font-archivo-medium",
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
      {value ? <Text numberOfLines={1} className="max-w-[38%] font-archivo-medium text-[12px] text-muted">{value}</Text> : null}
      {children ||
        (selected ? <Check size={18} color={colors.brand} /> : navigation ? (
          <ChevronRight size={20} color={colors.muted} />
        ) : null)}
    </Tappable>
  );
}
