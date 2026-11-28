import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  authenticateServer,
  clearStoredSession,
  loadStoredSession,
  probeServer,
  saveStoredSession,
  ServerUnauthorizedError,
  serverJson,
  type ServerAuth,
  type ServerSession,
  type ServerStatus,
} from "./server-client";
import { ServerCatalog } from "./server-catalog";

export type ServerConnectionStatus =
  | "loading"
  | "disconnected"
  | "connected"
  | "offline"
  | "revoked";

interface ServerContextValue {
  session: ServerSession | null;
  server: ServerStatus | null;
  status: ServerConnectionStatus;
  error: string | null;
  catalog: ServerCatalog | null;
  connect(address: string, auth: ServerAuth): Promise<ServerSession>;
  disconnect(): Promise<void>;
  retry(): Promise<void>;
  clearError(): void;
}

const Context = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<ServerSession | null>(null);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [status, setStatus] = useState<ServerConnectionStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const dropSession = useCallback(async () => {
    setSession(null);
    setServer(null);
    setStatus("revoked");
    await clearStoredSession();
  }, []);

  const verify = useCallback(async (value: ServerSession) => {
    const probed = await probeServer(value.address);
    if (probed.serverId !== value.serverId) {
      await dropSession();
      throw new Error(
        "That address now belongs to a different Plexy Server. Sign in again.",
      );
    }
    await serverJson(value, "/api/auth/me");
    return probed;
  }, [dropSession]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await loadStoredSession();
      if (!live) return;
      if (!stored) {
        setStatus("disconnected");
        return;
      }
      setSession(stored);
      try {
        const probed = await verify(stored);
        if (!live) return;
        setServer(probed);
        setStatus("connected");
      } catch (caught) {
        if (!live) return;
        if (caught instanceof ServerUnauthorizedError) {
          await dropSession();
          return;
        }
        setStatus("offline");
        setError(
          caught instanceof Error
            ? caught.message
            : "The server is not reachable right now.",
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [dropSession, verify]);

  const catalog = useMemo(
    () =>
      session
        ? new ServerCatalog(session, () => {
            void dropSession();
          })
        : null,
    [dropSession, session],
  );

  useEffect(() => {
    if (catalog && status === "connected")
      void catalog.refreshCounts().catch(() => {});
  }, [catalog, status]);

  const connect = useCallback(
    async (address: string, auth: ServerAuth) => {
      const next = await authenticateServer(address, auth);
      await saveStoredSession(next);
      setSession(next);
      setStatus("connected");
      setError(null);
      const probed = await probeServer(next.address).catch(() => null);
      setServer(
        probed ?? {
          version: "",
          serverId: next.serverId,
          setupComplete: true,
          ownerCreated: true,
        },
      );
      return next;
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (session) {
      await serverJson(session, "/api/auth/logout", { method: "POST" }).catch(
        () => {},
      );
    }
    await clearStoredSession();
    setSession(null);
    setServer(null);
    setStatus("disconnected");
    setError(null);
  }, [session]);

  const retry = useCallback(async () => {
    const current = session;
    if (!current) {
      setStatus("disconnected");
      return;
    }
    setStatus("loading");
    try {
      const probed = await verify(current);
      setServer(probed);
      setStatus("connected");
      setError(null);
    } catch (caught) {
      if (caught instanceof ServerUnauthorizedError) {
        await dropSession();
        return;
      }
      setStatus("offline");
      setError(
        caught instanceof Error
          ? caught.message
          : "The server is not reachable right now.",
      );
    }
  }, [dropSession, session, verify]);

  const value = useMemo<ServerContextValue>(
    () => ({
      session,
      server,
      status,
      error,
      catalog,
      connect,
      disconnect,
      retry,
      clearError: () => setError(null),
    }),
    [catalog, connect, disconnect, error, retry, server, session, status],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useServer() {
  const value = useContext(Context);
  if (!value) throw new Error("ServerProvider is missing");
  return value;
}
