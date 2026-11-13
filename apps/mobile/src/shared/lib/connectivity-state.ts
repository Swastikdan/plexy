export type OnlineState = boolean | null;

interface Connection {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}
interface ConnectivitySource {
  fetch(): Promise<Connection>;
  addEventListener(listener: (connection: Connection) => void): () => void;
}

/** One device-wide snapshot; null means connectivity has not been established. */
export function createConnectivityState(source: ConnectivitySource) {
  let online: OnlineState = null;
  let started: Promise<OnlineState> | undefined;
  let listening = false;
  let revision = 0;
  let request = 0;
  const listeners = new Set<() => void>();
  const publish = (connection: Connection) => {
    const next = connection.isConnected == null
      ? null
      : connection.isConnected && connection.isInternetReachable !== false;
    if (next === online) return;
    online = next;
    for (const listener of listeners) listener();
  };
  async function refresh(): Promise<OnlineState> {
    if (!listening) return start();
    const currentRevision = revision;
    const currentRequest = ++request;
    try {
      const connection = await source.fetch();
      // Events observed after a fetch began are newer than its snapshot.
      if (revision === currentRevision && request === currentRequest)
        publish(connection);
    } catch {
      // A failed status read must not prevent using the offline library.
    }
    return online;
  }
  function start(): Promise<OnlineState> {
    if (!listening) {
      listening = true;
      source.addEventListener((connection) => {
        revision++;
        publish(connection);
      });
      started = refresh();
    }
    return started!;
  }
  return {
    getSnapshot: () => online,
    start,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      void start();
      return () => { listeners.delete(listener); };
    },
  };
}
