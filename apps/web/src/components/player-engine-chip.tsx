/// Visible playback-engine indicator for the desktop app.
///
/// The viewer should never have to guess whether Plexy is using the native mpv
/// window or the browser player. It also offers the engine switch where the
/// choice is meaningful; websites render nothing.
import { useEffect, useState } from "react";
import { MonitorPlay, Tv } from "lucide-react";

import {
  markNativeAvailable,
  nativeBridge,
  PLAYER_ENGINE_EVENT,
  readPlayerEngine,
  savePlayerEngine,
  type PlayerEngine,
} from "../lib/native-playback";
import type { NativePlaybackInfo } from "../electron";

export function PlayerEngineChip({ className }: { className?: string }) {
  const [engine, setEngine] = useState<PlayerEngine>(() => readPlayerEngine());
  const [info, setInfo] = useState<NativePlaybackInfo | null | undefined>(() =>
    nativeBridge() ? undefined : null,
  );

  useEffect(() => {
    const bridge = nativeBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge
      .info()
      .then((next) => {
        if (cancelled) return;
        markNativeAvailable(next.available);
        setInfo(next);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    const onChange = () => setEngine(readPlayerEngine());
    window.addEventListener(PLAYER_ENGINE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(PLAYER_ENGINE_EVENT, onChange);
    };
  }, []);

  // Plain browsers and non-desktop installs have no engine choice to show.
  if (!nativeBridge()) return null;
  if (info === undefined) {
    return <span className={`text-[11px] text-muted ${className ?? ""}`}>Checking player…</span>;
  }

  const nativeActive = Boolean(info?.available) && engine === "native";
  const label = nativeActive ? "Native player (mpv)" : "Browser player";

  return (
    <div className={`flex flex-wrap items-center gap-2 text-[11px] text-muted ${className ?? ""}`}>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/85 px-2.5 py-1 font-medium text-foreground shadow-2xs backdrop-blur-md"
        title={nativeActive
          ? "Playback opens in a separate mpv window with native controls."
          : "Playback runs in this window with the browser player."}
      >
        {nativeActive ? <Tv size={12} /> : <MonitorPlay size={12} />}
        {label}
      </span>
      {info?.available ? (
        <button
          type="button"
          onClick={() => {
            const next: PlayerEngine = nativeActive ? "browser" : "native";
            savePlayerEngine(next);
            setEngine(next);
            window.dispatchEvent(new Event(PLAYER_ENGINE_EVENT));
          }}
          className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-accent transition-opacity hover:opacity-80"
        >
          {nativeActive ? "Use browser" : "Use mpv"}
        </button>
      ) : (
        <span
          className="text-[11px] text-muted/80"
          title={info?.reason ?? "The bundled native engine is not installed."}
        >
          mpv not installed
        </span>
      )}
    </div>
  );
}
