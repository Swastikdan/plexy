import * as SecureStore from "expo-secure-store";
import type { ServerSession } from "./transport";

export * from "./transport";

const SESSION_KEY = "plexy.server.session.v1";

export async function loadStoredSession(): Promise<ServerSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ServerSession>;
    if (
      typeof value.address !== "string" ||
      typeof value.serverId !== "string" ||
      typeof value.token !== "string" ||
      !value.user ||
      typeof value.user.id !== "number" ||
      typeof value.user.username !== "string" ||
      !value.device ||
      typeof value.device.id !== "string"
    )
      return null;
    return value as ServerSession;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: ServerSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
}
