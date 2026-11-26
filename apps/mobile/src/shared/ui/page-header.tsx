import React from "react";
import {
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import { ChevronLeft } from "./icons";
import { PlexyMark } from "./brand-logo";
import { Tappable } from "./tappable";

export function PageHeader({
  title,
  logo = false,
  right,
  className,
  style,
  subtitle,
  onBack,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  logo?: boolean;
  right?: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { canGoBack, back, navigate } = useRouter();
  const colors = useColors();
  return (
    <View
      className={cn(
        "flex-row items-center justify-between px-5 pt-[18px] pb-3 min-h-[64px]",
        className,
      )}
      style={style}
    >
      <View
        className={
          logo
            ? "flex-1 flex-row items-center gap-2"
            : "flex-1 flex-row items-start gap-2"
        }
      >
        {!logo && (
          <Tappable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={
              onBack ??
              (() => (canGoBack() ? back() : navigate("/")))
            }
            hitSlop={6}
            className="h-9 w-11 items-center justify-center"
          >
            <ChevronLeft size={26} color={colors.ink} />
          </Tappable>
        )}
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
          <View className="flex-1">
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              accessibilityRole="header"
              className="font-archivo-black text-[30px] leading-[36px] tracking-[-0.9px] text-foreground"
            >
              {title}
            </Text>
            {!!subtitle && (
              <Text className="mt-1 text-[13px] font-archivo-regular text-muted">
                {subtitle}
              </Text>
            )}
          </View>
        )}
      </View>
      {right ? (
        <View className="ml-2 max-w-[45%] flex-row items-center gap-2 shrink">
          {right}
        </View>
      ) : null}
    </View>
  );
}
