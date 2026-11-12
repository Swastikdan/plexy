import { useEffect,useState } from "react";
import { Text,View } from "react-native";
import { useOnline } from "../../../shared/hooks/use-online";
import { Button } from "../../../shared/ui/button";
import { Notice } from "../../../shared/ui/notice";
import { Label } from "../../../shared/ui/text";
import {
checkForUpdate,
downloadAndInstallUpdate,
getInstalledAppInfo,
type AppInfo,
type UpdateInfo,
} from "../lib/app-updater";
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
      await downloadAndInstallUpdate(update, setProgress);
      setMessage(
        "Complete installation in the Android installer, then reopen Plexy.",
      );
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
            label={progress !== null ? `${progress}%` : "Update now"}
            disabled={!online || busy}
            onPress={() => void install()}
          />
        </>
      )}
      {progress !== null && (
        <Text className="text-white">Downloading: {progress}%</Text>
      )}
      {!!message && <Notice message={message} />}
    </View>
  );
}
