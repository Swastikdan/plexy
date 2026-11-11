import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Heading, Label, Notice } from "../../packages/native-client/src/ui";
import { getInstalledAppInfo, checkForUpdate, downloadAndInstallUpdate, type AppInfo, type UpdateInfo } from "../../packages/native-client/src/updater";

export function Updates() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => { void getInstalledAppInfo().then(setInfo).catch(e => setMessage(String(e))); }, []);
  async function check() {
    setBusy(true); setMessage(""); setUpdate(null);
    try {
      const current = await getInstalledAppInfo(); setInfo(current);
      const latest = await checkForUpdate(false, current.buildNumber); setUpdate(latest);
      if (!latest) setMessage("Your app is up to date.");
    } catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  }
  async function install() {
    if (!update) return;
    setBusy(true); setMessage("");
    try { await downloadAndInstallUpdate(update, setProgress); setMessage("Complete installation in the Android installer, then reopen Plexy."); }
    catch (e) { setMessage(String(e)); } finally { setBusy(false); setProgress(null); }
  }
  return <View style={{ gap: 12 }}>

    <Label>{info ? `Installed: ${info.versionName}` : "Reading installed version…"}</Label>
    <Button label={busy ? "Please wait…" : "Check update"} disabled={busy} onPress={() => void check()} />
    {update && <><Label>Available: {update.tagName}</Label><Button label="Download and install" disabled={busy} onPress={() => void install()} /></>}
    {progress !== null && <Text style={{ color: "white" }}>Downloading: {progress}%</Text>}
    {!!message && <Notice message={message} />}
  </View>;
}
