import { useAppDialog } from "@/shared/ui/app-dialog";
import { useEffect,useState } from "react";
import {
checkForUpdate,
downloadAndInstallUpdate,
getInstalledAppInfo,
type AppInfo,
type UpdateInfo,
} from "@/features/settings/lib/app-updater";
export function useAppUpdates(online: boolean) {
  const showDialog = useAppDialog();
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
      const latest = await checkForUpdate(current);
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
  const downloadAndInstall = async () => {
    if (!availableUpdate || updateDownloading) return;
    setUpdateDownloading(true);
    setUpdateProgress(0);
    try {
      const result = await downloadAndInstallUpdate(
        availableUpdate,
        setUpdateProgress,
        () => setUpdateStatusText("Android installer opened. Confirm installation there."),
      );
      setUpdateStatusText(result === "installed"
        ? "Update installed. Reopen Plexy."
        : "Installation was not completed. Allow Plexy to install unknown apps, then tap Update now to retry.");
    } catch (e) {
      setUpdateStatusText(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateDownloading(false);
      setUpdateProgress(null);
    }
  };

  const handleDownloadAndInstall = () => {
    if (!availableUpdate || updateDownloading) return;
    showDialog("Download update?", `Download ${availableUpdate.tagName} (${(availableUpdate.apkSize / 1024 ** 2).toFixed(1)} MB)? Android will ask you to confirm installation after the download.`, [
      { text: "Download update", onPress: () => void downloadAndInstall() },
      { text: "Cancel", style: "cancel" },
    ]);
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
