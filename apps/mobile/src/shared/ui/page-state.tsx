import React from "react";
import { Text, View } from "react-native";
import { useColors, withAlpha } from "@/shared/theme";
import { Button } from "./button";
import { AlertCircle, type NativeIcon } from "./icons";

/**
 * Full-page error/offline state. Unlike Notice, this owns the whole content
 * area so a failed page reads as a normal screen instead of a floating card.
 */
export function PageState({
  icon: Icon = AlertCircle,
  title,
  message,
  actionLabel = "Try again",
  onAction,
  children,
}: {
  icon?: NativeIcon;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="alert"
      className="flex-1 items-center justify-center bg-background px-8 py-10"
    >
      <View
        className="h-16 w-16 items-center justify-center rounded-full border"
        style={{
          borderColor: withAlpha(colors.ink, 0.08),
          backgroundColor: colors.surface,
        }}
      >
        <Icon size={28} color={colors.muted} strokeWidth={1.8} />
      </View>
      <Text className="mt-5 text-center font-archivo-bold text-[24px] leading-[30px] text-foreground">
        {title}
      </Text>
      <Text className="mt-2 max-w-[320px] text-center font-archivo-regular text-[14px] leading-[21px] text-muted">
        {message}
      </Text>
      {onAction && (
        <Button
          label={actionLabel}
          primary
          onPress={onAction}
          className="mt-6 min-w-[150px]"
        />
      )}
      {children}
    </View>
  );
}
