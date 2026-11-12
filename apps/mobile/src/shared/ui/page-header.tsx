import React from "react";
import {
Text,
View,
type StyleProp,
type ViewStyle,
} from "react-native";
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
    <View
      className="flex-row items-center justify-between px-5 pt-[18px] pb-3 min-h-[64px]"
      style={style}
    >
      <View className="flex-row items-center gap-2 shrink">
        {logo ? (
          <>
            <PlexyMark size={24} />
            <Text
              accessibilityRole="header"
              className="font-archivo-black text-[30px] leading-[36px] tracking-[-0.9px] text-foreground"
            >
              Plexy
            </Text>
          </>
        ) : (
          <Text
            accessibilityRole="header"
            className="font-archivo-black text-[30px] leading-[36px] tracking-[-0.9px] text-foreground"
          >
            {title}
          </Text>
        )}
      </View>
      {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
    </View>
  );
}
