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

const LIGHT = {
  body: "#ECECEE",
  border: "#D6D6DA",
  screen: "#FAFAFB",
  notch: "#3B3B3F",
  indicator: "#3B3B3F",
};
const DARK = {
  body: "#2F2F32",
  border: "#49494D",
  screen: "#151517",
  notch: "#09090A",
  indicator: "#D8D8DC",
};
// Content sits on both halves of the System preview, so it uses a neutral
// gray that reads on either screen instead of the current app theme.
const CONTENT = "rgba(122,122,128,0.30)";
const CONTENT_STRONG = "rgba(122,122,128,0.52)";

/** A tiny app screen: status row, art block, then a list of rows. */
function ScreenContent() {
  return (
    <View
      pointerEvents="none"
      style={{ flex: 1, paddingHorizontal: 8, paddingTop: 13 }}
    >
      <View
        style={{
          width: 24,
          height: 4,
          borderRadius: 2,
          backgroundColor: CONTENT_STRONG,
        }}
      />
      <View
        style={{
          marginTop: 6,
          height: 23,
          borderRadius: 5,
          backgroundColor: CONTENT,
        }}
      />
      <View style={{ marginTop: 6, gap: 4 }}>
        <View
          style={{
            height: 5,
            width: "82%",
            borderRadius: 3,
            backgroundColor: CONTENT_STRONG,
          }}
        />
        <View
          style={{
            height: 5,
            width: "62%",
            borderRadius: 3,
            backgroundColor: CONTENT,
          }}
        />
      </View>
      <View
        style={{
          marginTop: 6,
          flexDirection: "row",
          gap: 4,
        }}
      >
        <View
          style={{
            flex: 1,
            height: 12,
            borderRadius: 4,
            backgroundColor: CONTENT,
          }}
        />
        <View
          style={{
            flex: 1,
            height: 12,
            borderRadius: 4,
            backgroundColor: CONTENT,
          }}
        />
      </View>
    </View>
  );
}

function PhonePreview({ mode }: { mode: Mode }) {
  const isSystem = mode === "system";
  const body = mode === "dark" ? DARK : LIGHT;
  const notch = isSystem ? "#1B1B1D" : body.notch;
  const indicator = isSystem ? "#8C8C92" : body.indicator;
  return (
    <View
      style={{
        width: 72,
        height: 104,
        borderRadius: 19,
        borderWidth: 1.5,
        borderColor: isSystem ? "#7B7B83" : body.border,
        backgroundColor: body.body,
        overflow: "hidden",
      }}
    >
      {isSystem && (
        <>
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "50%",
              backgroundColor: LIGHT.body,
            }}
          />
          <View
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "50%",
              backgroundColor: DARK.body,
            }}
          />
        </>
      )}
      <View
        style={{
          position: "absolute",
          left: 3,
          right: 3,
          top: 3,
          bottom: 3,
          borderRadius: 16,
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        {isSystem ? (
          <>
            <View style={{ flex: 1, backgroundColor: LIGHT.screen }} />
            <View style={{ flex: 1, backgroundColor: DARK.screen }} />
          </>
        ) : (
          <View style={{ flex: 1, backgroundColor: body.screen }} />
        )}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
        >
          <ScreenContent />
        </View>
      </View>
      <View
        style={{
          position: "absolute",
          top: 7,
          left: 26,
          width: 20,
          height: 4,
          borderRadius: 2,
          backgroundColor: notch,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 6,
          left: 25,
          width: 22,
          height: 2.5,
          borderRadius: 2,
          backgroundColor: indicator,
        }}
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
