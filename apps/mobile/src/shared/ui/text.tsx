import React from "react";
import { StyleSheet,Text } from "react-native";
import { colors,fonts } from "../theme";

export function Label({
  children,
  muted = false,
  style,
  numberOfLines,
  selectable,
}: React.PropsWithChildren<{
  muted?: boolean;
  style?: import("react-native").StyleProp<import("react-native").TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}>) {
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      style={[styles.text, muted && { color: colors.muted }, style]}
    >
      {children}
    </Text>
  );
}

export function Heading({
  children,
  large = false,
}: React.PropsWithChildren<{
  large?: boolean;
}>) {
  return (
    <Label
      style={{
        fontFamily: fonts.black,
        fontSize: large ? 34 : 24,
        lineHeight: large ? 42 : 32,
        letterSpacing: -0.5,
      }}
    >
      {children}
    </Label>
  );
}

const styles = StyleSheet.create({
text: {
    fontFamily: fonts.regular,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  }
});
