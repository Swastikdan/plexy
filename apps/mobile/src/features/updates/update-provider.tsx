import { fetchUpdateJson, UpdateRequestError } from "@/features/settings/lib/update-request";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import * as ExpoUpdates from "expo-updates";
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Modal, ScrollView, Text, View } from "react-native";
import { useOnline } from "@/shared/hooks/use-online";
import { useEventCallback } from "@/shared/hooks/use-event-callback";
import { Button } from "@/shared/ui/button";
import { Loading } from "@/shared/ui/loading";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { checkForUpdate, downloadAndInstallUpdate, getInstalledAppInfo, openUnknownAppsSettings, type AppInfo, type UpdateInfo } from "@/features/settings/lib/app-updater";
import { isUpdateRequired, manifestUpdate, mergeMobilePolicy, MOBILE_POLICY_URL, parseMobileManifest, type MobileUpdateManifest } from "@/features/settings/lib/mobile-update-manifest";

const POLICY_KEY = "plexy.mobile-update-policy.v1";
const DISMISSED_KEY = "plexy.mobile-update-dismissed.v1";
const CHECK_INTERVAL = 15 * 60_000;

function useUpdateCoordinator() {
  const online = useOnline();
  const showDialog = useAppDialog();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [policy, setPolicy] = useState<MobileUpdateManifest | null>(null);
  const [legacyUpdate, setLegacyUpdate] = useState<UpdateInfo | null>(null);
  const [otaAvailable, setOtaAvailable] = useState(false);
  const [otaPending, setOtaPending] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateStatusText, setUpdateStatusText] = useState("");
  const checking = useRef(false);
  const downloading = useRef(false);
  const lastCheck = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const policyRef = useRef<MobileUpdateManifest | null>(null);

  useEffect(() => {
    alive.current = true;
    void Promise.all([getInstalledAppInfo(), AsyncStorage.getItem(POLICY_KEY), AsyncStorage.getItem(DISMISSED_KEY)])
      .then(([installed, cached, hidden]) => {
        if (!alive.current) return;
        setAppInfo(installed);
        setDismissed(hidden);
        if (cached) {
          try {
            const validated = parseMobileManifest(JSON.parse(cached));
            policyRef.current = validated;
            setPolicy(validated);
          } catch { /* Invalid cached data cannot impose an update requirement. */ }
        }
      })
      .catch(error => { if (alive.current) setUpdateStatusText(String(error)); })
      .finally(() => { if (alive.current) setBootstrapped(true); });
    return () => {
      alive.current = false;
      activeRequest.current?.abort();
    };
  }, []);

  const check = useEventCallback(async (manual = false) => {
    if (!bootstrapped || !online || checking.current || downloading.current || (!manual && Date.now() - lastCheck.current < CHECK_INTERVAL)) return;
    checking.current = true;
    lastCheck.current = Date.now();
    setUpdateChecking(true);
    setUpdateStatusText("Checking for updates…");
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const installed = await getInstalledAppInfo();
      if (!alive.current) return;
      setAppInfo(installed);
      const [apk, ota] = await Promise.allSettled([
        (async () => {
          const response = await fetchUpdateJson(MOBILE_POLICY_URL, { signal: controller.signal });
          if (response.status === 404) {
            if (policyRef.current) throw new UpdateRequestError("The update policy is temporarily unavailable (HTTP 404). Please retry.", 404);
            const legacy = await checkForUpdate(installed, controller.signal);
            if (alive.current) setLegacyUpdate(legacy);
            return legacy;
          }
          const merged = mergeMobilePolicy(policyRef.current, parseMobileManifest(response.data));
          if (!alive.current) return null;
          policyRef.current = merged;
          setPolicy(merged);
          setLegacyUpdate(null);
          await AsyncStorage.setItem(POLICY_KEY, JSON.stringify(merged));
          return manifestUpdate(merged, installed.versionName, installed.versionCode);
        })(),
        ExpoUpdates.isEnabled && !otaPending ? ExpoUpdates.checkForUpdateAsync() : null,
      ]);
      if (!alive.current || controller.signal.aborted) return;
      const mustInstallApk = policyRef.current && isUpdateRequired(policyRef.current, installed.versionName);
      const hasOta = ota.status === "fulfilled" && (ota.value?.isAvailable || ota.value?.isRollBackToEmbedded);
      setOtaAvailable(Boolean(hasOta));
      if (mustInstallApk) setUpdateStatusText("An Android update is required.");
      else if (otaPending || hasOta) setUpdateStatusText(otaPending ? "Restart Plexy to apply the update." : "An app update is available.");
      else if (apk.status === "fulfilled" && apk.value) setUpdateStatusText(`Version ${apk.value.version || apk.value.tagName} is available.`);
      else if (apk.status === "rejected") throw apk.reason;
      else if (ota.status === "rejected") throw ota.reason;
      else setUpdateStatusText("Plexy is up to date.");
    } catch (error) {
      // Failed checks should not suppress recovery for the full success interval.
      lastCheck.current = Date.now() - CHECK_INTERVAL + 60_000;
      if (alive.current && !controller.signal.aborted) setUpdateStatusText(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      checking.current = false;
      if (alive.current) setUpdateChecking(false);
    }
  });

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    return () => subscription.remove();
  }, [online, bootstrapped, check]);

  const availableUpdate = appInfo && policy ? manifestUpdate(policy, appInfo.versionName, appInfo.versionCode) : legacyUpdate;
  const required = Boolean(appInfo && policy && isUpdateRequired(policy, appInfo.versionName));
  const offerOta = !required && (otaAvailable || otaPending);
  const applyOta = useEventCallback(async () => {
    if (!offerOta || downloading.current || checking.current) return;
    downloading.current = true;
    setUpdateDownloading(true);
    try {
      if (!otaPending) {
        setUpdateStatusText("Downloading app update…");
        const result = await ExpoUpdates.fetchUpdateAsync();
        setOtaAvailable(false);
        if (!result.isNew && !result.isRollBackToEmbedded) {
          setUpdateStatusText("No new update was downloaded. Check again to retry.");
          return;
        }
        setOtaPending(true);
      }
      setUpdateStatusText("Restarting Plexy…");
      await ExpoUpdates.reloadAsync();
    } catch (error) {
      if (alive.current) setUpdateStatusText(error instanceof Error ? error.message : String(error));
    } finally {
      downloading.current = false;
      if (alive.current) setUpdateDownloading(false);
    }
  });
  const install = useEventCallback(async () => {
    if (!availableUpdate || downloading.current || checking.current) return;
    downloading.current = true;
    setUpdateDownloading(true);
    setUpdateProgress(0);
    setUpdateStatusText("Downloading update…");
    try {
      const result = await downloadAndInstallUpdate(availableUpdate, percent => {
        if (!alive.current) return;
        setUpdateProgress(percent);
        setUpdateStatusText(percent === 100 ? "Opening Android installer…" : `Downloading update… ${percent}%`);
      }, () => setUpdateStatusText("Confirm installation in Android to finish updating."));
      if (!alive.current) return;
      // Only the installed native version can lift a mandatory gate.
      setAppInfo(await getInstalledAppInfo());
      setUpdateStatusText(result === "installed" ? "Installation finished. Reopen Plexy if the update screen remains." : "Installation was cancelled. Tap Update now to retry.");
    } catch (error) {
      if (alive.current) setUpdateStatusText(error instanceof Error ? error.message : String(error));
    } finally {
      downloading.current = false;
      if (alive.current) { setUpdateDownloading(false); setUpdateProgress(null); }
    }
  });
  const handleDownloadAndInstall = () => {
    if (required) { void install(); return; }
    if (offerOta) { void applyOta(); return; }
    if (!availableUpdate || updateDownloading) return;
    showDialog("Download update?", `Download version ${availableUpdate.version || availableUpdate.tagName} (${(availableUpdate.apkSize / 1024 ** 2).toFixed(1)} MB)? Android will ask you to confirm installation.`, [{ text: "Download update", onPress: () => void install() }]);
  };
  const dismiss = () => {
    if (required || !availableUpdate) return;
    setDismissed(availableUpdate.tagName);
    void AsyncStorage.setItem(DISMISSED_KEY, availableUpdate.tagName).catch(() => {});
  };
  return { appInfo, availableUpdate, updateChecking, updateDownloading, updateProgress, updateStatusText, handleCheckUpdate: () => check(true), handleDownloadAndInstall,
    bootstrapped, required, dismissed, dismiss, install, policy, online, offerOta, otaPending };
}

type Coordinator = ReturnType<typeof useUpdateCoordinator>;
const Context = createContext<Coordinator | null>(null);

function UpdateContent({ state, required }: { state: Coordinator; required: boolean }) {
  const title = required ? "Update required" : state.availableUpdate?.updateType === "feature" ? "New features available" : "Update available";
  return <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28, gap: 16 }} className="bg-background">
    <Text accessibilityRole="header" className="font-archivo-bold text-foreground text-[28px]">{title}</Text>
    <Text className="text-muted text-[16px]">{required ? "Update Plexy to continue using the app." : state.policy?.message || "A newer version of Plexy is ready to install."}</Text>
    <Text className="text-foreground text-[16px]">Version {state.availableUpdate?.version || state.availableUpdate?.tagName || state.policy?.latestVersion}</Text>
    {!!state.availableUpdate?.releaseNotes && <Text className="text-muted text-[14px]">{state.availableUpdate.releaseNotes}</Text>}
    <Button primary label={state.updateDownloading ? `Updating${state.updateProgress != null ? `… ${state.updateProgress}%` : "…"}` : "Update now"} disabled={!state.online || !state.availableUpdate || state.updateChecking || state.updateDownloading} onPress={() => void state.install()} />
    {!state.online && <Text className="text-muted">Connect to the internet to download this update.</Text>}
    {!!state.updateStatusText && <Text accessibilityLiveRegion="polite" className="text-muted">{state.updateStatusText}</Text>}
    <Button label={state.updateChecking ? "Checking…" : "Check again"} disabled={!state.online || state.updateChecking || state.updateDownloading} onPress={() => void state.handleCheckUpdate()} />
    <Button label="Allow app installation" onPress={() => void openUnknownAppsSettings().catch(() => {})} />
    {!required && <Button label="Later" disabled={state.updateDownloading} onPress={state.dismiss} />}
  </ScrollView>;
}

export function UpdateProvider({ children }: PropsWithChildren) {
  const state = useUpdateCoordinator();
  const path = usePathname();
  const optional = state.availableUpdate?.updateType !== "feature";
  const notice = Boolean(!state.offerOta && state.availableUpdate && state.availableUpdate.tagName !== state.dismissed && !path.includes("/player/"));
  return <Context.Provider value={state}>
    {!state.bootstrapped ? <Loading /> : state.required ? <View className="flex-1 bg-background"><UpdateContent state={state} required /></View> : children}
    <Modal transparent={optional} visible={state.bootstrapped && !state.required && notice} animationType="fade" onRequestClose={() => { if (!state.updateDownloading) state.dismiss(); }} supportedOrientations={["portrait", "landscape"]}>
      {optional ? <View className="flex-1 justify-center bg-black/50 px-5"><View className="overflow-hidden rounded-[24px] bg-background" style={{ maxHeight: "85%" }}><UpdateContent state={state} required={false} /></View></View> : <UpdateContent state={state} required={false} />}
    </Modal>
  </Context.Provider>;
}
export function useUpdates() {
  const value = useContext(Context);
  if (!value) throw Error("UpdateProvider is missing.");
  return value;
}
