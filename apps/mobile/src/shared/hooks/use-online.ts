import { useSyncExternalStore } from "react";
import { connectivity } from "@/shared/lib/connectivity";

export function useOnline() {
  return useSyncExternalStore(
    connectivity.subscribe,
    connectivity.getSnapshot,
    connectivity.getSnapshot,
  ) === true;
}
