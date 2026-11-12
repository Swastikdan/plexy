import React from "react";
import { Text } from "react-native";
import { cn } from "@/shared/lib/cn";

export function Label({
  children,
  muted = false,
  style,
  className,
  numberOfLines,
  selectable,
}: React.PropsWithChildren<{
  muted?: boolean;
  style?: import("react-native").StyleProp<import("react-native").TextStyle>;
  className?: string;
  numberOfLines?: number;
  selectable?: boolean;
}>) {
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      className={cn(
        "text-[15px] leading-[22px] font-archivo-regular text-foreground",
        muted && "text-muted",
        className,
      )}
      style={style}
    >
      {children}
    </Text>
  );
}

export function Heading({
  children,
  large = false,
  className,
}: React.PropsWithChildren<{
  large?: boolean;
  className?: string;
}>) {
  return (
    <Label
      className={cn(
        "font-archivo-black tracking-[-0.5px]",
        large ? "text-[34px] leading-[42px]" : "text-[24px] leading-[32px]",
        className,
      )}
    >
      {children}
    </Label>
  );
}
