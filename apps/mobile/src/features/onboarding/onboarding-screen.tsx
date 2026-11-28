import { useEffect, useState } from "react";
import { Directory } from "expo-file-system";
import { useRouter } from "expo-router";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "@/shared/ui/safe-area-view";
import { canFinishOnboarding } from "@/core/client/watching-mode";
import { useClient } from "@/core/client/client-provider";
import { useServer } from "@/core/server/server-provider";
import { serverLabel } from "@/core/server/server-client";
import { modeLabels, modePreferences, type AppMode } from "@/core/client/preferences";
import { displayName, localLibrary } from "@/core/library/local-runtime";
import { useColors } from "@/shared/theme";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { Button } from "@/shared/ui/button";
import { ChevronLeft } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";

const descriptions: Record<AppMode, string> = {
  local: "Watch videos from your media folders. Keep online browsing and streaming out of the way.",
  hybrid: "Your media folders and the online catalog together. Add folders now or whenever you’re ready.",
  online: "Browse and watch online. No folders, library scans or local playback settings.",
};

export function OnboardingScreen({
  onClose,
  onDone,
}: {
  /** Set when the screen is opened from Settings, so it can return there. */
  onClose?: () => void;
  /** Set when finishing should close the screen instead of replacing the app root. */
  onDone?: () => void;
} = {}) {
  const colors = useColors();
  const { preferences, updatePreferences } = useClient();
  const plexyServer = useServer();
  const serverConnected = plexyServer.status === "connected" && plexyServer.session;
  const router = useRouter();
  const dialog = useAppDialog();
  const [mode, setMode] = useState<AppMode>(preferences.mode);
  const [step, setStep] = useState<"mode" | "setup">("mode");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, refresh] = useState(0);
  useEffect(() => localLibrary.subscribe(() => refresh(n => n + 1)), []);
  useEffect(() => {
    if (step !== "setup") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busy) setStep("mode");
      return true;
    });
    return () => listener.remove();
  }, [step, busy]);
  const folders = localLibrary.state.roots.filter(root => !root.singleFile);
  const canFinish = canFinishOnboarding(mode, folders.length) || (Boolean(serverConnected) && mode === "local");
  const finish = () => {
    if (!canFinish) return;
    updatePreferences({
      ...modePreferences(mode),
      ...(serverConnected && mode === "local" ? { source: "all" as const } : {}),
      onboardingCompleted: true,
      onlineDisclaimerSeen: mode !== "local" || preferences.onlineDisclaimerSeen,
    });
    if (onDone) onDone();
    else router.replace("/");
  };
  const pick = async (kind: "movies" | "tv") => {
    setBusy(true);
    setError("");
    try {
      const folder = await Directory.pickDirectoryAsync();
      await localLibrary.addRoot({ uri: folder.uri, name: displayName(folder.uri), kind });
    } catch (e) {
      if (!/cancel/i.test(String(e))) setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20, flexGrow: 1 }}>
        <View className="flex-row items-center gap-2">
          {onClose && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onClose}
              hitSlop={8}
              className="-ml-2 h-10 w-10 items-center justify-center rounded-full active:opacity-70"
            >
              <ChevronLeft size={26} color={colors.ink} />
            </Pressable>
          )}
          <Text className="font-archivo-black text-[26px] text-foreground">{onClose ? "Watching mode" : "Plexy"}</Text>
        </View>
        <View className="gap-3 pt-5">
          <Text accessibilityRole="header" className="font-archivo-bold text-[34px] leading-[40px] text-foreground">
            {step === "mode" ? "How do you like to watch?" : mode === "online" ? "Your next watch awaits." : "Make room for your collection."}
          </Text>
          <Text className="font-archivo-regular text-[16px] leading-[24px] text-muted">
            {step === "mode" ? "Choose your Plexy experience. You can change it later in Settings." : mode === "local" ? "Add a media folder to continue." : mode === "hybrid" ? "Add a media folder now or start online." : "You’re ready to browse the online catalog. No media folders needed."}
          </Text>
        </View>
        {step === "mode" ? (
          <>
            <View className="gap-3" accessibilityRole="radiogroup">
              {(["local", "hybrid", "online"] as const).map(value => (
                <Pressable key={value} testID={`mode-${value}`} accessibilityRole="radio" accessibilityState={{ checked: mode === value }} onPress={() => setMode(value)} className={`rounded-[18px] border-2 p-5 gap-2 ${mode === value ? "border-foreground bg-surface" : "border-border bg-background active:opacity-70"}`}>
                  <Text className="font-archivo-bold text-[20px] text-foreground">{modeLabels[value]}</Text>
                  <Text className="font-archivo-regular text-[14px] leading-[21px] text-muted">{descriptions[value]}</Text>
                </Pressable>
              ))}
            </View>
            <Button primary label={mode === "online" || folders.length ? "Continue" : "Configure"} onPress={() => setStep("setup")} />
          </>
        ) : (
          <>
            <View className="gap-2 rounded-[18px] border border-border bg-surface p-4">
              <Text className="font-archivo-bold text-[16px] text-foreground">Plexy Server</Text>
              <Text className="font-archivo-regular text-[13px] leading-5 text-muted">
                {serverConnected
                  ? `Connected to ${serverLabel(plexyServer.session!)}. Pick it as the library source in Settings.`
                  : "Optional: connect a Plexy Server to browse its library from this app."}
              </Text>
              <Button
                label={serverConnected ? "Manage server" : "Connect server"}
                onPress={() => router.push("/server-connect")}
              />
            </View>
            {mode !== "online" && <>
              {folders.map((folder) => (
                <View key={folder.uri} className="flex-row items-center justify-between gap-3 py-1">
                  <Text className="shrink font-archivo-medium text-[15px] text-foreground">
                    {folder.name || displayName(folder.uri)}
                  </Text>
                  <Text className="font-archivo-medium text-[12px] text-muted">Connected</Text>
                </View>
              ))}
              <Button label={busy ? "Adding folder…" : "Add media folder"} disabled={busy} onPress={() => dialog("Add media folder", "What’s in this folder?", (["movies", "tv"] as const).map(kind => ({ text: kind === "tv" ? "TV shows" : "Movies", onPress: () => void pick(kind) })))} />
            </>}
            {mode !== "local" && <Notice message="Plexy does not host online titles. Metadata comes from TMDB and playback uses third-party sources. Availability may vary by title and region." />}
            {!!error && <Notice message={error} />}
            <View className="flex-1" />
            <Button primary testID="finish-onboarding" label={mode === "hybrid" && !folders.length ? "Start without folders" : "Start watching"} disabled={busy || !canFinish} onPress={finish} />
            <Button label="Change mode" disabled={busy} onPress={() => setStep("mode")} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
