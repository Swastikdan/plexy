import React from "react";
import { Pressable,StyleSheet,Text,View } from "react-native";
import { triggerHaptic } from "../../../shared/lib/haptics";
import { colors,fonts } from "../../../shared/theme";
import { Icon } from "../../../shared/ui/icon";

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
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.hover },
      ]}
    >
      {icon && (
        <View style={styles.icon}>
          <Icon name={icon} size={20} color={colors.muted} />
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.rowTitle, danger && { color: colors.danger }]}>
          {title}
        </Text>
        {!!subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      {children ||
        (onPress && (
          <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>
        ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
row: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
icon: { width: 24, alignItems: "center" },
rowTitle: { color: colors.ink, fontSize: 15, fontFamily: fonts.medium },
rowSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
  }
});
