import { useEffect, useState } from "react";
import { Switch } from "@heroui/react";

/** This preference belongs to the desktop process, including when no API is running. */
export function DesktopServerSettings() {
  const desktop = window.electronAPI;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void desktop
      ?.getLocalServerEnabled()
      .then(setEnabled)
      .catch(() => setError("Could not read server preference."));
  }, [desktop]);
  if (!desktop?.setLocalServerEnabled) return null;
  return (
    <div className="my-4 space-y-2 rounded-2xl border border-border bg-surface p-4">
      <Switch
        isSelected={enabled === true}
        isDisabled={busy || enabled === null}
        onChange={async (isSelected) => {
          setBusy(true);
          setError("");
          try {
            await desktop.setLocalServerEnabled(isSelected);
            setEnabled(isSelected);
          } catch {
            setError("Could not change server mode.");
            setBusy(false);
          }
        }}
        className="w-full"
      >
        <Switch.Content className="flex w-full items-center justify-between gap-4">
          <span>Run local server</span>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
      <p className="text-xs text-muted">
        Use the bundled library server on this computer. Turn it off to connect
        to another server. Changing this reopens the Plexy window.
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger-soft-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
