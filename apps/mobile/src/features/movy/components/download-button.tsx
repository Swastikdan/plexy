import { Pressable, Text, View } from "react-native";
import { cn } from "@/shared/lib/cn";
import { useColors } from "@/shared/theme";
import { Check, Download, Pause, Play, RotateCcw } from "@/shared/ui/icons";
import type { MovyDownloadRecord } from "../lib/types";

export type DownloadButtonState =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "done"
  | "failed";

export function downloadButtonState(
  record: MovyDownloadRecord | undefined,
): DownloadButtonState {
  if (!record) return "idle";
  if (record.status === "completed") return "done";
  if (record.status === "downloading" || record.status === "verifying")
    return "downloading";
  if (record.status === "paused") return "paused";
  if (record.status === "failed") return "failed";
  return "queued";
}

export function DownloadButton({
  state,
  progress = 0,
  onPress,
  size = 40,
  className,
  accessibilityLabel,
}: {
  state: DownloadButtonState;
  progress?: number;
  onPress: () => void;
  size?: number;
  className?: string;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const percent = Math.max(0, Math.min(99, Math.round(progress * 100)));
  const label =
    accessibilityLabel ??
    (state === "done"
      ? "Downloaded"
      : state === "downloading"
        ? `Downloading ${percent}%`
        : state === "queued"
          ? "Queued for download"
          : state === "paused"
            ? "Paused download"
            : state === "failed"
              ? "Retry download"
              : "Download");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: state === "done" }}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={{ width: size, height: size }}
      className={cn(
        "items-center justify-center rounded-full border border-border bg-surface active:opacity-70",
        state === "done" && "border-accent/40 bg-accent/15",
        state === "failed" && "border-danger/40 bg-danger/10",
        className,
      )}
    >
      {state === "downloading" ? (
        <View className="items-center justify-center">
          <Text className="font-archivo-bold text-[10px] text-foreground">
            {percent}%
          </Text>
        </View>
      ) : state === "done" ? (
        <Check size={18} color={colors.brand} strokeWidth={2.4} />
      ) : state === "paused" ? (
        <Play size={16} color={colors.ink} fill={colors.ink} />
      ) : state === "failed" ? (
        <RotateCcw size={17} color={colors.danger} />
      ) : state === "queued" ? (
        <Pause size={16} color={colors.muted} />
      ) : (
        <Download size={18} color={colors.ink} />
      )}
    </Pressable>
  );
}
