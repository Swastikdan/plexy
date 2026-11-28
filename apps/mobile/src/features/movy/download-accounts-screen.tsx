/// Settings → Downloads → Accounts: every Movy account, its quota, and the
/// automatic account creation rules (cap and backoff).
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useIsFocused } from "expo-router";
import { useClient } from "@/core/client/client-provider";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { useColors } from "@/shared/theme";
import { SettingsRow } from "@/features/settings/components/settings-row";
import { Check, Trash2 } from "@/shared/ui/icons";
import { AccountSheet } from "./components/account-sheet";
import { useMovy } from "./movy-provider";
import {
  accountCreationBackoff,
  quotaLabel,
  replacementsToday,
  resetAccountCreationBackoff,
  resetLabel,
  type AccountBackoff,
} from "./lib/account";

function minutesUntil(time: number, now: number) {
  const minutes = Math.max(1, Math.ceil((time - now) / 60_000));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
    : `${minutes} min`;
}

export function DownloadAccountsScreen() {
  const colors = useColors();
  const showDialog = useAppDialog();
  const focused = useIsFocused();
  const { preferences, updatePreferences } = useClient();
  const movy = useMovy();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [backoff, setBackoff] = useState<AccountBackoff>({ failures: 0, until: 0 });
  const [replacements, setReplacements] = useState(0);
  const [now, setNow] = useState(0);

  const refresh = useCallback(() => {
    void accountCreationBackoff().then((value) => {
      setBackoff(value);
      setNow(Date.now());
    });
    void replacementsToday().then(setReplacements);
  }, []);
  useEffect(() => {
    if (focused) refresh();
  }, [focused, refresh, movy.accounts]);

  const known = movy.accounts.filter((account) => account.quota && account.quota.limit > 0);
  const remaining = known.reduce((sum, account) => sum + (account.quota?.remaining ?? 0), 0);
  const limit = known.reduce((sum, account) => sum + (account.quota?.limit ?? 0), 0);
  const unknown = movy.accounts.length - known.length;
  const active = movy.downloads.filter(
    (record) => record.status === "downloading" || record.status === "queued" || record.status === "verifying",
  ).length;
  const completed = movy.downloads.filter((record) => record.status === "completed").length;
  const backingOff = now > 0 && backoff.until > now;

  const confirmRemove = (username: string) =>
    showDialog(
      "Remove this account?",
      "Plexy forgets the account on this device. Downloads already saved stay in your library.",
      [
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void movy.removeAccount(username),
        },
      ],
    );

  return (
    <View className="flex-1">
      <PageHeader title="Download accounts" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {movy.error ? <Notice kind="error" message={movy.error} /> : null}

        <View className="flex-row gap-3">
          {[
            { label: "Downloads left", value: known.length ? String(remaining) : "—", note: limit ? `of ${limit}${unknown ? ` · ${unknown} unknown` : ""}` : unknown ? `${unknown} unknown` : "No quota yet" },
            { label: "In progress", value: String(active), note: `${completed} downloaded` },
          ].map((tile) => (
            <View key={tile.label} className="flex-1 gap-1 rounded-[18px] bg-surface p-4">
              <Text className="font-archivo-medium text-[12px] text-muted">{tile.label}</Text>
              <Text className="font-archivo-bold text-[26px] text-foreground">{tile.value}</Text>
              <Text className="font-archivo-regular text-[11px] text-muted">{tile.note}</Text>
            </View>
          ))}
        </View>

        <Text className="mt-2 ml-[2px] text-[13px] font-archivo-medium text-muted">Accounts</Text>
        <View className="overflow-hidden rounded-[18px] bg-surface">
          {movy.accounts.length ? (
            movy.accounts.map((account) => {
              const selected = account.username === movy.active?.username;
              const reset = resetLabel(account.quota);
              return (
                <SettingsRow
                  key={account.username}
                  title={account.username}
                  value={`${quotaLabel(account.quota)}${reset ? ` · ${reset}` : ""}`}
                  onPress={selected ? undefined : () => void movy.selectAccount(account.username)}
                >
                  <View className="flex-row items-center gap-3">
                    {selected ? <Check size={18} color={colors.ink} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${account.username}`}
                      hitSlop={8}
                      onPress={() => confirmRemove(account.username)}
                      className="h-9 w-9 items-center justify-center rounded-full bg-surface-secondary active:opacity-70"
                    >
                      <Trash2 size={16} color={colors.danger} />
                    </Pressable>
                  </View>
                </SettingsRow>
              );
            })
          ) : (
            <SettingsRow title="No download account" />
          )}
        </View>
        <Button
          label="Add account"
          className="self-start"
          disabled={movy.busy}
          onPress={() => {
            movy.clearError();
            setSheetOpen(true);
          }}
        />

        <Text className="mt-2 ml-[2px] text-[13px] font-archivo-medium text-muted">
          Automatic accounts
        </Text>
        <View className="overflow-hidden rounded-[18px] bg-surface">
          <SettingsRow title="Create when the quota runs out">
            <ToggleSwitch
              value={preferences.movyAutoCreateAccount}
              onValueChange={(value) => updatePreferences({ movyAutoCreateAccount: value })}
              accessibilityLabel="Create an account when the quota runs out"
            />
          </SettingsRow>
          {preferences.movyAutoCreateAccount ? (
            <>
              <SettingsRow
                navigation
                title="Accounts per 24 hours"
                value={`${replacements} of ${preferences.movyAccountCap} used`}
                onPress={() =>
                  showDialog(
                    "Accounts per 24 hours",
                    "The most accounts Plexy creates automatically in one day.",
                    ([1, 2, 3] as const).map((cap) => ({
                      text: String(cap),
                      selected: preferences.movyAccountCap === cap,
                      onPress: () => updatePreferences({ movyAccountCap: cap }),
                    })),
                  )
                }
              />
              <SettingsRow
                title="Request backoff"
                value={
                  backingOff
                    ? `Paused · ${minutesUntil(backoff.until, now)}`
                    : backoff.failures
                      ? `${backoff.failures} recent failures`
                      : "Ready"
                }
                onPress={
                  backoff.failures
                    ? () =>
                        showDialog(
                          "Reset backoff?",
                          "After too many account requests Plexy waits before trying again, doubling the wait after each failure. Reset only if the source is reachable again.",
                          [
                            {
                              text: "Reset",
                              onPress: () => void resetAccountCreationBackoff().then(refresh),
                            },
                          ],
                        )
                    : undefined
                }
              />
            </>
          ) : null}
        </View>
      </ScrollView>
      <AccountSheet
        key={sheetOpen ? "accounts-sheet-open" : "accounts-sheet-closed"}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}
