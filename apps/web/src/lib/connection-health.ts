export type ConnectionHealth = "online" | "offline" | "unavailable";

const EVENT_NAME = "plexy:connection-health";

export function reportConnectionHealth(state: ConnectionHealth): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ConnectionHealth>(EVENT_NAME, { detail: state }));
}

export function subscribeConnectionHealth(listener: (state: ConnectionHealth) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (event: Event) => listener((event as CustomEvent<ConnectionHealth>).detail);
  window.addEventListener(EVENT_NAME, handle);
  return () => window.removeEventListener(EVENT_NAME, handle);
}
