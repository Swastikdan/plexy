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
      {busy && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm" role="status" aria-live="polite">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-foreground" />
          <p className="text-sm font-semibold text-foreground">Switching server mode…</p>
          <p className="max-w-xs text-center text-xs text-muted">
            Starting or stopping the bundled server and rebuilding the connection.
          </p>
        </div>
      )}
      <Switch
        isSelected={enabled === true}
        isDisabled={busy || enabled === null}
        onChange={async (isSelected) => {
          setBusy(true);
          setError("");
          try {
            await desktop.setLocalServerEnabled(isSelected);
            setEnabled(isSelected);
            window.setTimeout(() => setBusy(false), 8_000);
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
