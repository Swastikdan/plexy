import React from "react";
import {
StyleSheet,
Text,
View,
type StyleProp,
type ViewStyle,
} from "react-native";
import { colors,fonts } from "../theme";
import { PlexyMark } from "./brand-logo";

export function PageHeader({
  title,
  logo = false,
  right,
  style,
}: {
  title?: string;
  logo?: boolean;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.pageHeader, style]}>
      <View style={styles.pageHeaderTitleRow}>
        {logo ? (
          <>
            <PlexyMark size={24} />
            <Text accessibilityRole="header" style={styles.pageTitle}>
              Plexy
            </Text>
          </>
        ) : (
          <Text accessibilityRole="header" style={styles.pageTitle}>
            {title}
          </Text>
        )}
      </View>
      {right ? <View style={styles.pageHeaderRight}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    minHeight: 64,
  },
pageHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
pageTitle: {
    fontFamily: fonts.black,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.9,
    color: colors.ink,
  },
pageHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  }
});
