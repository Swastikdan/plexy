import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useServer } from "@/core/server/server-provider";
import { serverLabel } from "@/core/server/server-client";
import { normalizeServerAddress } from "@/core/server/address";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import { HardDrive, WifiOff } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { Screen } from "@/shared/ui/screen";

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "url";
}) {
  const colors = useColors();
  return (
    <View className="gap-1.5">
      <Text className="font-archivo-medium text-[13px] text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.quiet}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-[14px] bg-surface px-4 py-3.5 font-archivo-regular text-[16px] text-foreground"
        accessibilityLabel={label}
      />
    </View>
  );
}

export function ServerConnectScreen() {
  const router = useRouter();
  const colors = useColors();
  const { session, server, status, error, connect, disconnect, retry } =
    useServer();
  const [address, setAddress] = useState(session?.address ?? "");
  const [auth, setAuth] = useState<"pairing" | "password">("pairing");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState(session?.user.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const connected = status === "connected";
  const showForm = !connected;

  const submit = async () => {
    setLocalError("");
    setBusy(true);
    try {
      await connect(
        address,
        auth === "pairing"
          ? { kind: "pairing", code }
          : { kind: "password", username, password },
      );
      router.back();
    } catch (caught) {
      setLocalError(
        caught instanceof Error ? caught.message : "Could not connect to the server.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Plexy Server"
      subtitle="Connect this phone to the server running on your Mac or Linux machine."
      onBack={() => router.back()}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}
        keyboardShouldPersistTaps="handled"
      >
        {session && (
          <View className="gap-3 rounded-[18px] bg-surface p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-default">
                <HardDrive size={19} color={colors.ink} />
              </View>
              <View className="flex-1">
                <Text className="font-archivo-bold text-[16px] text-foreground">
                  {serverLabel(session)}
                </Text>
                <Text className="font-archivo-regular text-[13px] text-muted">
                  {session.user.username}
                  {server ? ` · ${server.version}` : ""}
                </Text>
              </View>
              <View
                className={`h-2.5 w-2.5 rounded-full ${
                  connected ? "bg-accent" : "bg-warning"
                }`}
              />
            </View>
            <Text className="font-archivo-regular text-[13px] leading-5 text-muted">
              {connected
                ? "Hybrid mode combines this server with folders on this device. The device copy is shown when a title exists in both places."
                : status === "revoked"
                  ? "The server session was revoked or expired. Sign in again to keep using its library."
                  : "The server is saved but not reachable right now. Device folders still work."}
            </Text>
            <View className="flex-row gap-2">
              {!connected && (
                <Button
                  label={status === "loading" ? "Checking…" : "Retry"}
                  disabled={status === "loading"}
                  onPress={() => void retry()}
                />
              )}
              <Button
                label="Disconnect"
                onPress={() => void disconnect()}
              />
            </View>
          </View>
        )}

        {showForm && (
          <View className="gap-4">
            <Field
              label="Server address"
              value={address}
              onChangeText={setAddress}
              placeholder="https://192.168.1.20:8766"
              keyboardType="url"
            />
            <Text className="font-archivo-regular text-[12px] leading-[18px] text-muted">
              Use the HTTPS address printed by the server. On the same Wi-Fi,
              accept the server certificate in the browser first.
            </Text>
            <Button
              compact
              label="Download server certificate"
              disabled={!address.trim()}
              onPress={() => {
                try {
                  const url = normalizeServerAddress(address);
                  void Linking.openURL(`${url}/api/server/certificate`).catch(
                    () => setLocalError("Could not open the certificate download."),
                  );
                } catch (caught) {
                  setLocalError(
                    caught instanceof Error ? caught.message : "Invalid address.",
                  );
                }
              }}
            />
            <Text className="font-archivo-regular text-[11px] leading-[17px] text-muted">
              Android may warn about the certificate. Download it, then install
              it under Settings → Security → Encryption & credentials → Install
              a certificate → CA certificate.
            </Text>

            <View className="flex-row gap-2 rounded-[14px] bg-surface p-1">
              {(
                [
                  ["pairing", "Pairing code"],
                  ["password", "Account"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: auth === value }}
                  onPress={() => setAuth(value)}
                  className={`flex-1 rounded-[11px] px-3 py-2.5 ${
                    auth === value ? "bg-background" : "active:opacity-70"
                  }`}
                >
                  <Text
                    className={`text-center font-archivo-medium text-[13px] ${
                      auth === value ? "text-foreground" : "text-muted"
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {auth === "pairing" ? (
              <>
                <Field
                  label="Pairing code"
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                />
                <Text className="font-archivo-regular text-[12px] leading-[18px] text-muted">
                  Create a code in the server’s Settings → Devices panel.
                </Text>
              </>
            ) : (
              <>
                <Field
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  placeholder="owner"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry
                />
              </>
            )}

            {(!!localError || !!error) && (
              <Notice message={localError || error || ""} />
            )}

            <Button
              primary
              label={busy ? "Connecting…" : "Connect"}
              disabled={
                busy ||
                !address.trim() ||
                (auth === "pairing" ? !code.trim() : !username.trim() || !password)
              }
              onPress={() => void submit()}
            />
          </View>
        )}

        {connected && (
          <View className="flex-row items-start gap-3 rounded-[18px] bg-surface p-4">
            <WifiOff size={18} color={colors.quiet} />
            <Text className="flex-1 font-archivo-regular text-[12px] leading-[18px] text-muted">
              Switching servers keeps each account’s watch state and downloads
              separate. Disconnect before handing the phone to a different
              account.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
