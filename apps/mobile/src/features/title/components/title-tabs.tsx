import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { cn } from "@/shared/lib/cn";

/**
 * The underline tab strip on a title page (Episodes / More Like This /
 * Details). The active tab is marked by an accent underline rather than a
 * filled pill, matching the reference layout.
 */
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
    <View
      accessibilityRole="tablist"
      className={cn("flex-row gap-6 border-b border-border", className)}
    >
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
              "min-h-11 justify-center border-b-2 pb-2.5 pt-1 active:opacity-70",
              active
                ? "border-b-accent"
                : focus === tab.key
                  ? "border-b-accent/60"
                  : "border-b-transparent",
            )}
            style={{ marginBottom: -1 }}
          >
            <Text
              className={cn(
                "font-archivo-bold text-[15px] tracking-[-0.1px]",
                active ? "text-foreground" : "text-muted",
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
