import React from "react";
import { View } from "react-native";
import { Spinner, type SpinnerSize } from "./spinner";

/** Page-level loading state. Feature content uses skeletons instead. */
export function Loading({
  size = "md",
  label = "Loading",
}: {
  size?: SpinnerSize;
  label?: string;
} = {}) {
  return (
    <View className="flex-1 items-center justify-center bg-background p-12">
      <Spinner size={size} accessibilityLabel={label} />
    </View>
  );
}
