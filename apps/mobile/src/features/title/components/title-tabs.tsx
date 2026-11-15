import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { cn } from "@/shared/lib/cn";

/** The two-pill segmented control on a series title screen. */
export function TitleTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  return (
    <View className={cn("flex-row gap-1.5 rounded-full bg-surface p-1", className)}>
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.key)}
            onFocus={() => setFocus(tab.key)}
            onBlur={() => setFocus(null)}
            className={cn(
              "min-h-11 flex-1 items-center justify-center rounded-full px-4 py-2.5",
              active ? "bg-foreground" : "bg-transparent",
              focus === tab.key && "border-2 border-accent",
            )}
          >
            <Text
              className={cn(
                "text-[15px]",
                active
                  ? "font-archivo-bold text-background"
                  : "font-archivo-medium text-muted",
              )}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
