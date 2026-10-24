/// The address the HTTP listener actually bound to at startup.
///
/// `config.json` can change while the server is running (the Admin page edits
/// it live), but a new bind address only takes effect on the next start. The
/// status endpoint reports the live binding next to the saved one so the UI can
/// ask for a restart instead of silently showing stale settings.
export interface LiveBinding {
  bind: string;
  port: number;
  /** Reachable `http://<lan-ip>:<port>` URLs, only when bound to 0.0.0.0. */
  lanUrls: string[];
}

let live: LiveBinding = { bind: "", port: 0, lanUrls: [] };

export function setLiveBinding(next: LiveBinding): void {
  live = next;
}

export function getLiveBinding(): LiveBinding {
  return live;
}
