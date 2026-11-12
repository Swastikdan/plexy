import { View } from "react-native";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Label } from "./text";

export function Notice({
  message,
  retry,
  kind = "info",
}: {
  message: string;
  retry?: () => void;
  kind?: "info" | "error";
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      className="p-4 bg-surface-secondary rounded-[10px] border border-white/[0.08] gap-3.5 my-3"
    >
      <Label
        className={cn(kind === "error" ? "text-danger" : "text-foreground")}
      >
        {message}
      </Label>
      {retry && <Button label="Retry" onPress={retry} />}
    </View>
  );
}
