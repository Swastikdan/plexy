import { useEffect, useState } from "react";

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
    <div className="my-4 space-y-2 border border-border p-4">
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={busy || enabled === null}
          onChange={async (event) => {
            const next = event.target.checked;
            setBusy(true);
            setError("");
            try {
              await desktop.setLocalServerEnabled(next);
              setEnabled(next);
            } catch {
              setError("Could not change server mode.");
              setBusy(false);
            }
          }}
        />
        Run local server
      </label>
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
