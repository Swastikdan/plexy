import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Directory } from "expo-file-system";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { Check, Trash2, X } from "@/shared/ui/icons";
import { useColors } from "@/shared/theme";
import { useMovy } from "../movy-provider";
import { quotaLabel, resetLabel } from "../lib/account";
import type { MovyAccountRecord } from "../lib/types";

export function AccountSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const movy = useMovy();
  const [mode, setMode] = useState<"choose" | "signin" | "created">("choose");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<MovyAccountRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const saveDetails = async (account: MovyAccountRecord) => {
    if (!account.generatedPassword) return;
    setSaving(true);
    setSaveError(null);
    try {
      const directory = await Directory.pickDirectoryAsync();
      const file = directory.createFile(
        `plexy-account-${Date.now()}.txt`,
        "text/plain",
      );
      file.write(
        `Plexy online download account\nUser ID: ${account.username}\nPassword: ${account.generatedPassword}\n`,
      );
      setDone("Account details saved.");
    } catch (cause) {
      if (!/cancel|dismiss/i.test(String(cause))) {
        setSaveError("Could not save account details. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    try {
      const account = await movy.createAccount();
      setCreated(account);
      setMode("created");
    } catch {
      // The provider shows the error.
    }
  };

  const submit = async () => {
    if (!username.trim() || !password) return;
    try {
      await movy.signIn(username.trim(), password);
      setPassword("");
      setDone("Signed in.");
      onClose();
    } catch {
      // The provider shows the error.
    }
  };

  const active = movy.active;
  const accountCard = (account: MovyAccountRecord, current: boolean) => (
    <Pressable
      key={account.username}
      onPress={() => void movy.selectAccount(account.username)}
      className="flex-row items-center gap-3 border-b-[0.33px] border-border px-4 py-3"
      accessibilityRole="radio"
      accessibilityState={{ checked: current }}
    >
      <View className="flex-1 gap-0.5">
        <Text className="font-archivo-medium text-[14px] text-foreground">
          {account.username}
        </Text>
        <Text className="font-archivo-regular text-[11px] text-muted">
          {quotaLabel(account.quota)}
          {resetLabel(account.quota) ? ` · ${resetLabel(account.quota)}` : ""}
        </Text>
      </View>
      {current ? <Check size={16} color={colors.brand} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${account.username}`}
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          void movy.removeAccount(account.username);
        }}
        className="h-8 w-8 items-center justify-center rounded-full bg-danger/10"
      >
        <Trash2 size={14} color={colors.danger} />
      </Pressable>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="max-h-[88%] rounded-t-[24px] bg-overlay pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 18) }}
        >
          <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3">
            <Text className="flex-1 font-archivo-bold text-[20px] text-foreground">
              Download account
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface"
            >
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 14 }}
          >
            {movy.error ? <Notice kind="error" message={movy.error} /> : null}
            {done ? <Notice message={done} /> : null}
            {saveError ? <Notice kind="error" message={saveError} /> : null}

            {mode === "created" && created ? (
              <>
                <Notice message="Account created. Save these details if you want to use this account on another device." />
                <View className="gap-3 rounded-[16px] bg-surface p-4">
                  <View className="gap-1">
                    <Text className="font-archivo-medium text-[12px] text-muted">
                      Username
                    </Text>
                    <Text selectable className="font-archivo-bold text-[16px] text-foreground">
                      {created.username}
                    </Text>
                  </View>
                  <View className="gap-1">
                    <Text className="font-archivo-medium text-[12px] text-muted">
                      Password
                    </Text>
                    <Text selectable className="font-archivo-bold text-[16px] text-foreground">
                      {created.generatedPassword ?? "—"}
                    </Text>
                  </View>
                </View>
                <Button
                  label={saving ? "Saving…" : "Save account details (.txt)"}
                  disabled={saving}
                  onPress={() => void saveDetails(created)}
                />
                <Button label="Done" primary onPress={onClose} />
              </>
            ) : mode === "signin" ? (
              <>
                <Text className="font-archivo-regular text-[13px] leading-[19px] text-muted">
                  Use an existing Movy account. This is only used for downloads;
                  playback stays on Vidy.
                </Text>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Username"
                  placeholderTextColor={colors.muted}
                  className="min-h-[52px] rounded-[14px] bg-surface px-4 font-archivo-regular text-[15px] text-foreground"
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Password"
                  placeholderTextColor={colors.muted}
                  className="min-h-[52px] rounded-[14px] bg-surface px-4 font-archivo-regular text-[15px] text-foreground"
                />
                <Button
                  label={movy.busy ? "Signing in…" : "Sign in"}
                  primary
                  disabled={movy.busy || !username.trim() || !password}
                  onPress={() => void submit()}
                />
                <Pressable onPress={() => setMode("choose")} className="items-center py-2">
                  <Text className="font-archivo-medium text-[13px] text-muted">
                    Back
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text className="font-archivo-regular text-[13px] leading-[19px] text-muted">
                  Downloads come from a separate Movy account. Plexy is not
                  affiliated with Movy. The app can create an account with
                  generated credentials, or you can sign in to one you already
                  have.
                </Text>

                {movy.accounts.length > 0 ? (
                  <View className="overflow-hidden rounded-[16px] bg-surface">
                    {movy.accounts.map((account) =>
                      accountCard(account, account.username === active?.username),
                    )}
                  </View>
                ) : null}

                {active?.generatedPassword ? (
                  <Button
                    label={saving ? "Saving…" : "Save active account details (.txt)"}
                    disabled={saving}
                    onPress={() => void saveDetails(active)}
                  />
                ) : null}

                <Button
                  label={movy.busy ? "Creating account…" : "Create a new account"}
                  primary
                  disabled={movy.busy}
                  onPress={() => void create()}
                />
                <Button
                  label="I already have an account"
                  onPress={() => setMode("signin")}
                />
                {movy.busy ? (
                  <ActivityIndicator color={colors.muted} />
                ) : null}
                <Text className="font-archivo-regular text-[11px] leading-[16px] text-muted">
                  Each account has its own download quota. Creating multiple
                  accounts may violate Movy’s terms. Use this only for your own
                  personal downloads.
                </Text>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
