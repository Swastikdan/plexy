import { useEffect, useRef, useState } from "react";
export type PlayerMenu = "settings" | "quality" | "episodes" | null;
export function usePlayerControls({
  playing,
  status,
  scrub,
}: {
  playing: boolean;
  status: string;
  scrub: number | null;
}) {
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<PlayerMenu>(null);
  const [speedPanel, setSpeedPanel] = useState(false);
  const [audioPanel, setAudioPanel] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlockHint, setUnlockHint] = useState(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInteraction = useRef(Date.now());
  const reveal = () => {
    if (lockedRef.current) return;
    lastInteraction.current = Date.now();
    setVisible(true);
  };
  const lockScreen = () => {
    setMenu(null);
    setSpeedPanel(false);
    setAudioPanel(false);
    setVisible(false);
    setUnlockHint(false);
    setLocked(true);
  };
  const unlockScreen = () => {
    setLocked(false);
    setUnlockHint(false);
    lastInteraction.current = Date.now();
    setVisible(true);
  };
  const showUnlockHint = () => {
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    setUnlockHint(true);
    unlockTimer.current = setTimeout(() => setUnlockHint(false), 2600);
  };
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        playing &&
        status !== "loading" &&
        !menu &&
        !speedPanel &&
        !audioPanel &&
        scrub == null &&
        Date.now() - lastInteraction.current > 6000
      )
        setVisible(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, menu, speedPanel, audioPanel, scrub, status]);

  const toggleControls = () => {
    lastInteraction.current = Date.now();
    setVisible((current) => !current);
  };
  useEffect(
    () => () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    },
    [],
  );
  return {
    visible,
    setVisible,
    menu,
    setMenu,
    speedPanel,
    setSpeedPanel,
    audioPanel,
    setAudioPanel,
    locked,
    lockedRef,
    unlockHint,
    reveal,
    lockScreen,
    unlockScreen,
    showUnlockHint,
    lastInteraction,
    toggleControls,
  };
}
