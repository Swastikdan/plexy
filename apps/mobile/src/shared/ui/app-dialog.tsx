import { createContext, useContext, useState, type PropsWithChildren } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { X } from "./icons";
import { cn } from "@/shared/lib/cn";

type DialogAction = {
  text: string;
  style?: "cancel" | "destructive" | "default";
  onPress?: () => void;
};
type ShowDialog = (title: string, message: string, actions: DialogAction[]) => void;
const Context = createContext<ShowDialog | null>(null);

/** App-owned choices and confirmations; OS permission screens remain native. */
export function AppDialogProvider({ children }: PropsWithChildren) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [dialog, setDialog] = useState<{
    title: string; message: string; actions: DialogAction[];
  } | null>(null);
  const close = () => {
    triggerHaptic("light");
    setDialog(null);
  };
  return (
    <Context.Provider value={(title, message, actions) => setDialog({ title, message, actions })}>
      {children}
      <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={close}
        supportedOrientations={["portrait", "landscape"]} statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/50"
          style={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
          <Pressable className="absolute inset-0" onPress={close} accessible={false} />
          <View className="w-full max-w-[420px] max-h-full rounded-[24px] border border-border bg-overlay p-5"
            accessibilityViewIsModal>
            <View className="flex-row items-center gap-3">
              <Text accessibilityRole="header" className="flex-1 text-[20px] font-archivo-bold text-foreground">
                {dialog?.title}
              </Text>
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close dialog"
                className="h-12 w-12 items-center justify-center rounded-full bg-default active:opacity-70">
                <X size={22} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingTop: 12 }}>
              <Text className="mb-2 text-[14px] leading-[21px] font-archivo-regular text-muted">{dialog?.message}</Text>
              {dialog?.actions.map((action, index) => (
                <Pressable key={`${index}-${action.text}`} accessibilityRole="button"
                  onPress={() => {
                    close();
                    // Let the custom modal unmount before opening an OS picker.
                    if (action.onPress) setTimeout(action.onPress, 0);
                  }}
                  className={cn("min-h-[52px] justify-center rounded-full px-5 py-3 active:opacity-70",
                    action.style === "destructive" ? "bg-danger/15" : "bg-default")}>
                  <Text className={cn("text-center text-[15px] font-archivo-medium",
                    action.style === "destructive" ? "text-danger" : "text-default-foreground")}>
                    {action.text}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Context.Provider>
  );
}

export function useAppDialog() {
  const show = useContext(Context);
  if (!show) throw new Error("AppDialogProvider is missing");
  return show;
}
