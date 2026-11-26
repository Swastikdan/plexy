import { Pressable, Text, View } from "react-native";
import type { Preferences } from "@/core/client/preferences";
import { cn } from "@/shared/lib/cn";
import { triggerHaptic } from "@/shared/lib/haptics";

type Mode = Preferences["theme"];

const OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Light mode" },
  { value: "dark", label: "Dark", hint: "Dark mode" },
  { value: "system", label: "System", hint: "Follow the system appearance" },
];

// Content sits on both halves of the System preview, so it uses a neutral
// gray that reads on either screen instead of the current app theme.
// (Literal colors: the preview is an illustration, not themed UI.)

/** A tiny app screen: status row, art block, then a list of rows. */
function ScreenContent() {
  return (
    <View
      pointerEvents="none"
      className="flex-1 px-2 pt-[13px]"
    >
      <View className="h-1 w-6 rounded-full bg-[rgba(122,122,128,0.52)]" />
      <View className="mt-1.5 h-[23px] rounded-[5px] bg-[rgba(122,122,128,0.30)]" />
      <View className="mt-1.5 gap-1">
        <View className="h-[5px] w-[82%] rounded-full bg-[rgba(122,122,128,0.52)]" />
        <View className="h-[5px] w-[62%] rounded-full bg-[rgba(122,122,128,0.30)]" />
      </View>
      <View className="mt-1.5 flex-row gap-1">
        <View className="h-3 flex-1 rounded-[4px] bg-[rgba(122,122,128,0.30)]" />
        <View className="h-3 flex-1 rounded-[4px] bg-[rgba(122,122,128,0.30)]" />
      </View>
    </View>
  );
}

function PhonePreview({ mode }: { mode: Mode }) {
  const isSystem = mode === "system";
  return (
    <View
      className={cn(
        "h-[104px] w-[72px] rounded-[19px] border-[1.5px] overflow-hidden",
        isSystem
          ? "border-[#7B7B83]"
          : mode === "dark"
            ? "border-[#49494D]"
            : "border-[#D6D6DA]",
        mode === "dark" ? "bg-[#2F2F32]" : "bg-[#ECECEE]",
      )}
    >
      {isSystem && (
        <>
          <View className="absolute inset-y-0 left-0 w-1/2 bg-[#ECECEE]" />
          <View className="absolute inset-y-0 right-0 w-1/2 bg-[#2F2F32]" />
        </>
      )}
      <View className="absolute inset-[3px] flex-row overflow-hidden rounded-[16px]">
        {isSystem ? (
          <>
            <View className="flex-1 bg-[#FAFAFB]" />
            <View className="flex-1 bg-[#151517]" />
          </>
        ) : (
          <View
            className={cn(
              "flex-1",
              mode === "dark" ? "bg-[#151517]" : "bg-[#FAFAFB]",
            )}
          />
        )}
        <View className="absolute inset-0">
          <ScreenContent />
        </View>
      </View>
      <View
        className={cn(
          "absolute left-[26px] top-[7px] h-1 w-5 rounded-full",
          isSystem
            ? "bg-[#1B1B1D]"
            : mode === "dark"
              ? "bg-[#09090A]"
              : "bg-[#3B3B3F]",
        )}
      />
      <View
        className={cn(
          "absolute bottom-[6px] left-[25px] h-[2.5px] w-[22px] rounded-full",
          isSystem
            ? "bg-[#8C8C92]"
            : mode === "dark"
              ? "bg-[#D8D8DC]"
              : "bg-[#3B3B3F]",
        )}
      />
    </View>
  );
}

export function AppearanceModeSelector({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
}) {
  return (
    <View className="rounded-[22px] bg-surface p-3">
      <View className="flex-row">
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={option.hint}
              onPress={() => {
                if (active) return;
                triggerHaptic("selection");
                onChange(option.value);
              }}
              className="flex-1 items-center gap-2.5 rounded-[18px] py-1.5 active:scale-[0.97]"
            >
              <View
                className={cn(
                  "rounded-[22px] border-2 p-[2px]",
                  active ? "border-accent" : "border-transparent",
                )}
              >
                <PhonePreview mode={option.value} />
              </View>
              <View
                className={cn(
                  "min-w-[68px] items-center rounded-full px-3 py-1.5",
                  active ? "bg-accent" : "bg-foreground/[0.06]",
                )}
              >
                <Text
                  className={cn(
                    "font-archivo-medium text-[12.5px]",
                    active ? "text-white" : "text-muted",
                  )}
                >
                  {option.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
