import { useEffect,useState } from "react";
import {
checkForUpdate,
downloadAndInstallUpdate,
getInstalledAppInfo,
type AppInfo,
type UpdateInfo,
} from "../lib/app-updater";
export function useAppUpdates(online: boolean) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(
    null,
  );
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateStatusText, setUpdateStatusText] = useState("");
  useEffect(() => {
    void getInstalledAppInfo()
      .then(setAppInfo)
      .catch(() => {});
  }, []);
  const handleCheckUpdate = async () => {
    if (!online || updateChecking || updateDownloading) return;
    setUpdateChecking(true);
    setUpdateStatusText("Checking for updates…");
    try {
      const current = await getInstalledAppInfo();
      setAppInfo(current);
      const latest = await checkForUpdate(current.buildNumber);
      setAvailableUpdate(latest);
      if (latest) {
        setUpdateStatusText(
          `Update ${latest.tagName} available (${(latest.apkSize / (1024 * 1024)).toFixed(1)} MB)`,
        );
      } else {
        setUpdateStatusText("Plexy is up to date");
      }
    } catch (e) {
      setUpdateStatusText(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateChecking(false);
    }
  };
  const handleDownloadAndInstall = async () => {
    if (!availableUpdate || updateDownloading) return;
    setUpdateDownloading(true);
    setUpdateProgress(0);
    try {
      await downloadAndInstallUpdate(availableUpdate, (pct) =>
        setUpdateProgress(pct),
      );
      setUpdateStatusText(
        "Installing… Complete installation in Android prompt",
      );
    } catch (e) {
      setUpdateStatusText(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateDownloading(false);
      setUpdateProgress(null);
    }
  };

  return {
    appInfo,
    availableUpdate,
    updateChecking,
    updateDownloading,
    updateProgress,
    updateStatusText,
    handleCheckUpdate,
    handleDownloadAndInstall,
  };
}
