import { useEffect,useState } from "react";
import { Linking,Text,View } from "react-native";
import { useOnline } from "@/shared/hooks/use-online";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { Label } from "@/shared/ui/text";
import {
checkForUpdate,
downloadAndInstallUpdate,
getInstalledAppInfo,
openUnknownAppsSettings,
type AppInfo,
type UpdateInfo,
} from "@/features/settings/lib/app-updater";
export function Updates() {
  const online = useOnline();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    void getInstalledAppInfo()
      .then(setInfo)
      .catch((e) => setMessage(String(e)));
  }, []);
  async function check() {
    if (!online) return;
    setBusy(true);
    setMessage("");
    setUpdate(null);
    try {
      const current = await getInstalledAppInfo();
      setInfo(current);
      const latest = await checkForUpdate(current.buildNumber);
      setUpdate(latest);
      if (!latest) setMessage("Your app is up to date.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function install() {
    if (!online || !update) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await downloadAndInstallUpdate(update, setProgress, () =>
        setMessage("Android installer opened. Confirm installation there."),
      );
      setMessage(result === "installed"
        ? "Update installed. Reopen Plexy."
        : "Installation was not completed. Allow Plexy to install unknown apps, then retry.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  return (
    <View className="gap-3">
      <Label>
        {info ? `Installed: ${info.versionName}` : "Reading installed version…"}
      </Label>
      <Button
        label={busy ? "Please wait…" : "Check update"}
        disabled={!online || busy}
        onPress={() => void check()}
      />
      {update && (
        <>
          <Label>Available: {update.tagName}</Label>
          <Button
            primary
            style={{ width: 120, flexShrink: 0 }}
            label={progress === 100 ? "Install…" : progress !== null ? `${progress}%` : "Update now"}
            disabled={!online || busy}
            onPress={() => void install()}
          />
          <Button
            label="Allow installations"
            disabled={busy}
            onPress={() => void openUnknownAppsSettings().catch((error) => setMessage(String(error)))}
          />
          <Button
            label="Download in browser"
            disabled={busy || !online}
            onPress={() => void Linking.openURL(update.apkUrl).catch((error) => setMessage(String(error)))}
          />
        </>
      )}
      {progress !== null && progress < 100 && (
        <Text className="text-white">Downloading: {progress}%</Text>
      )}
      {!!message && <Notice message={message} />}
    </View>
  );
}
