import { normalizeServerAddress } from "./address";

const REQUEST_TIMEOUT_MS = 10_000;

export interface ServerStatus {
  version: string;
  serverId: string;
  setupComplete: boolean;
  ownerCreated: boolean;
}

export interface ServerSession {
  address: string;
  serverId: string;
  token: string;
  user: { id: number; username: string; role: string };
  device: { id: string; name: string };
  connectedAt: number;
}

export type ServerAuth =
  | { kind: "pairing"; code: string }
  | { kind: "password"; username: string; password: string };

export class ServerUnauthorizedError extends Error {
  constructor(message = "The server session is no longer valid.") {
    super(message);
    this.name = "ServerUnauthorizedError";
  }
}

export class ServerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServerRequestError";
  }
}

export { normalizeServerAddress, serverLabel } from "./address";

function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* non-JSON server response */
  }
  return `The server returned HTTP ${response.status}.`;
}

/** Probe an address before saving it or asking for credentials. */
export async function probeServer(address: string): Promise<ServerStatus> {
  const normalized = normalizeServerAddress(address);
  const { signal, clear } = timeoutSignal(8_000);
  let response: Response;
  try {
    response = await fetch(`${normalized}/api/server/status`, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError")
      throw new Error("The server did not respond in time.");
    throw new Error(
      "Could not reach the server. Check the address, the Wi-Fi network, and the server certificate.",
    );
  } finally {
    clear();
  }
  if (!response.ok)
    throw new ServerRequestError(await readError(response), response.status);
  let body: Partial<ServerStatus>;
  try {
    body = (await response.json()) as Partial<ServerStatus>;
  } catch {
    throw new Error("That address does not look like a Plexy Server.");
  }
  if (typeof body.serverId !== "string" || typeof body.version !== "string")
    throw new Error("That address does not look like a Plexy Server.");
  return {
    version: body.version,
    serverId: body.serverId,
    setupComplete: Boolean(body.setupComplete),
    ownerCreated: Boolean(body.ownerCreated),
  };
}

export async function authenticateServer(
  address: string,
  auth: ServerAuth,
): Promise<ServerSession> {
  const normalized = normalizeServerAddress(address);
  const status = await probeServer(normalized);
  if (!status.ownerCreated)
    throw new Error("Finish creating the owner account on the server first.");
  const path = auth.kind === "pairing" ? "/api/auth/pair" : "/api/auth/login";
  const body =
    auth.kind === "pairing"
      ? { code: auth.code.trim(), name: "Plexy for Android" }
      : {
          username: auth.username.trim(),
          password: auth.password,
          name: "Plexy for Android",
        };
  const { signal, clear } = timeoutSignal(15_000);
  try {
    const response = await fetch(`${normalized}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok)
      throw new ServerRequestError(await readError(response), response.status);
    const value = (await response.json()) as {
      token?: unknown;
      user?: { id?: unknown; username?: unknown; role?: unknown };
      device?: { id?: unknown; name?: unknown };
      serverId?: unknown;
    };
    if (
      typeof value.token !== "string" ||
      !value.user ||
      typeof value.user.id !== "number" ||
      typeof value.user.username !== "string" ||
      typeof value.user.role !== "string" ||
      !value.device ||
      typeof value.device.id !== "string" ||
      typeof value.device.name !== "string"
    )
      throw new Error("The server returned an incomplete sign-in response.");
    return {
      address: normalized,
      serverId:
        typeof value.serverId === "string" ? value.serverId : status.serverId,
      token: value.token,
      user: {
        id: value.user.id,
        username: value.user.username,
        role: value.user.role,
      },
      device: { id: value.device.id, name: value.device.name },
      connectedAt: Date.now(),
    };
  } finally {
    clear();
  }
}

export async function serverResponse(
  session: ServerSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { signal, clear } = timeoutSignal();
  try {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${session.token}`);
    const response = await fetch(
      `${session.address}${path.startsWith("/") ? path : `/${path}`}`,
      { ...init, headers, signal },
    );
    if (response.status === 401) throw new ServerUnauthorizedError();
    return response;
  } finally {
    clear();
  }
}

export async function serverJson<T>(
  session: ServerSession,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await serverResponse(session, path, init);
  if (!response.ok)
    throw new ServerRequestError(await readError(response), response.status);
  return (await response.json()) as T;
}

export function serverAuthHeaders(session: ServerSession) {
  return { Authorization: `Bearer ${session.token}` };
}

export function serverMediaUrl(session: ServerSession, path: string) {
  return `${session.address}${path.startsWith("/") ? path : `/${path}`}`;
}
