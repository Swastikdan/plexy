import { useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { isValidFamilyPin } from "@/core/content/family-pin";
import { useColors } from "@/shared/theme";
import { Lock } from "@/shared/ui/icons";

/**
 * A small keypad-free PIN sheet. It is used to set the Kids & Family PIN and
 * to unlock the mode before its settings can be changed.
 */
export function PinDialog({
  visible,
  mode,
  title,
  description,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  mode: "set" | "verify";
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean> | boolean;
}) {
  const colors = useColors();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPin("");
    setConfirm("");
    setError("");
    setBusy(false);
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    if (!isValidFamilyPin(pin)) {
      setError("Enter a 4-digit PIN.");
      return;
    }
    if (mode === "set" && pin !== confirm) {
      setError("The PINs do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (await onSubmit(pin)) {
        close();
      } else {
        setError("That PIN is not correct.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that PIN.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View className="flex-1 items-center justify-center bg-black/70 px-6">
        <Pressable
          className="absolute inset-0"
          accessible={false}
          onPress={close}
        />
        <View
          accessibilityViewIsModal
          className="w-full max-w-[400px] gap-4 rounded-[22px] border border-border bg-overlay p-5"
        >
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-surface">
              <Lock size={20} color={colors.ink} />
            </View>
            <View className="flex-1">
              <Text
                accessibilityRole="header"
                className="font-archivo-bold text-[19px] text-foreground"
              >
                {title}
              </Text>
              {description ? (
                <Text className="mt-1 font-archivo-regular text-[12px] leading-[18px] text-muted">
                  {description}
                </Text>
              ) : null}
            </View>
          </View>
          <TextInput
            value={pin}
            onChangeText={(value) => {
              setPin(value.replace(/\D/g, "").slice(0, 4));
              setError("");
            }}
            placeholder={mode === "set" ? "New 4-digit PIN" : "4-digit PIN"}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            autoFocus
            accessibilityLabel={mode === "set" ? "New PIN" : "Family PIN"}
            className="min-h-[52px] rounded-[14px] border border-border bg-surface px-4 text-center font-archivo-bold text-[22px] tracking-[8px] text-foreground"
          />
          {mode === "set" ? (
            <TextInput
              value={confirm}
              onChangeText={(value) => {
                setConfirm(value.replace(/\D/g, "").slice(0, 4));
                setError("");
              }}
              placeholder="Confirm PIN"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              accessibilityLabel="Confirm PIN"
              className="min-h-[52px] rounded-[14px] border border-border bg-surface px-4 text-center font-archivo-bold text-[22px] tracking-[8px] text-foreground"
            />
          ) : null}
          {!!error && (
            <Text className="text-center font-archivo-medium text-[13px] text-danger">
              {error}
            </Text>
          )}
          <View className="flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={close}
              className="min-h-[48px] flex-1 items-center justify-center rounded-full bg-default active:opacity-70"
            >
              <Text className="font-archivo-medium text-[15px] text-default-foreground">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === "set" ? "Save PIN" : "Unlock"}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void submit()}
              className="min-h-[48px] flex-1 items-center justify-center rounded-full bg-accent active:opacity-80"
            >
              <Text className="font-archivo-bold text-[15px] text-white">
                {busy ? "Checking…" : mode === "set" ? "Save PIN" : "Unlock"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
