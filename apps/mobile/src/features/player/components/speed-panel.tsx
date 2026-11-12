import React from "react";
import { Modal,Pressable,Text,View } from "react-native";
import { colors } from "@/shared/theme";
import { cn } from "@/shared/lib/cn";
import { IconCheck } from "./player-icons";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Compact speed picker anchored to the left side of the landscape player. */
export function SpeedPanel({
  visible,
  rate,
  onClose,
  onSelect,
}: {
  visible: boolean;
  rate: number;
  onClose: () => void;
  onSelect: (rate: number) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["landscape"]}
    >
      <View className="flex-1 bg-black/55">
        <Pressable
          className="absolute inset-0"
          accessibilityLabel="Close speed picker"
          onPress={onClose}
        />
        <View
          className="absolute w-[264px] rounded-[18px] border border-white/10 bg-[#0d0e12] p-2.5"
          style={{
            left: 18,
            top: "50%",
            transform: [{ translateY: -158 }],
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 20,
          }}
        >
          <Text className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[1.2px] text-white/[0.42]">
            Playback speed
          </Text>
          {RATES.map((value) => {
            const active = Math.abs(rate - value) < 0.001;
            return (
              <Pressable
                key={String(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(value)}
                className={cn(
                  "flex-row items-center justify-between rounded-[12px] px-3.5 py-3 active:bg-white/10",
                  active && "bg-white/[0.08]",
                )}
              >
                <Text
                  className={cn(
                    "text-[15px]",
                    active ? "font-bold text-white" : "font-medium text-white/85",
                  )}
                >
                  {value}×
                </Text>
                {active && <IconCheck size={16} color={colors.brand} />}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}
