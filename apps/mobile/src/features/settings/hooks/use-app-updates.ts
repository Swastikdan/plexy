import { useUpdates } from "@/features/updates/update-provider";
/** Settings shares the startup coordinator, download state, and cached policy. */
export function useAppUpdates(_online: boolean) {
  return useUpdates();
}
