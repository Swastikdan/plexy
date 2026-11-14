/// Desktop playback always uses the native mpv engine.
import { useEffect, useState } from "react";
import { nativeBridge } from "../lib/native-playback";
import type { NativePlaybackInfo } from "../electron";

export function PlayerEngineChip({ className }: { className?: string }) {
  const [info, setInfo] = useState<NativePlaybackInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    nativeBridge()?.info().then((next) => {
      if (!cancelled) setInfo(next);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!nativeBridge()) return null;
  return (
    <span className={`text-[11px] text-muted ${className ?? ""}`} title={info?.reason}>
      {info === null ? "Checking native player…" : info.available ? "Native player (mpv)" : "Native player unavailable"}
    </span>
  );
}
