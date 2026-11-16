import React from "react";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/shared/theme";
import type { NativeIcon } from "@/shared/ui/icons";

export interface QuickAction {
  key: string;
  icon: NativeIcon;
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * The centered icon row under the rating: My List on online titles and
 * Watched on downloaded-only ones.
 */
export function TitleQuickActions({ actions }: { actions: QuickAction[] }) {
  const colors = useColors();
  return (
    <View className="flex-row items-start justify-center gap-16 py-1">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={
              action.accessibilityLabel ?? action.label
            }
            accessibilityState={{ disabled: action.disabled }}
            disabled={action.disabled}
            onPress={action.onPress}
            className="min-w-[64px] items-center gap-2 rounded-lg py-1 active:opacity-60"
            style={action.disabled ? { opacity: 0.4 } : undefined}
          >
            <Icon size={26} color={colors.brand} strokeWidth={1.9} />
            <Text className="font-archivo-medium text-[13px] text-accent">
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
