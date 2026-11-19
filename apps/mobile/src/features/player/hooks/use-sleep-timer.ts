import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useEventCallback } from "@/shared/hooks/use-event-callback";

export type SleepChoice = "off" | "end" | 15 | 30 | 60;
export type SleepTimer = { choice: Exclude<SleepChoice, "off">; deadline: number | null };

export interface PlaybackSleepTimer {
  timer: SleepTimer | null;
  setTimer: (timer: SleepTimer | null) => void;
}

export function useSleepTimer(onExpire: () => void, shared?: PlaybackSleepTimer) {
  const [ownTimer, setOwnTimer] = useState<SleepTimer | null>(null);
  const timer = shared ? shared.timer : ownTimer;
  const setTimer = shared?.setTimer ?? setOwnTimer;
  const expire = useEventCallback(() => {
    setTimer(null);
    onExpire();
  });
  useEffect(() => {
    const deadline = timer?.deadline;
    if (deadline == null) return;
    let fired = false;
    const check = () => {
      if (fired || Date.now() < deadline) return;
      fired = true;
      expire();
    };
    const timeout = setTimeout(check, Math.max(0, deadline - Date.now()));
    const subscription = AppState.addEventListener("change", check);
    return () => {
      clearTimeout(timeout);
      subscription.remove();
    };
  }, [timer, expire]);
  const finish = useEventCallback(() => {
    if (timer?.choice === "end") expire();
  });
  return {
    choice: (timer?.choice ?? "off") as SleepChoice,
    choose(choice: SleepChoice) {
      setTimer(choice === "off" ? null : { choice, deadline: choice === "end" ? null : Date.now() + choice * 60_000 });
    },
    finish,
  };
}
