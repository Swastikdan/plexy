import { Bonjour, type Service } from "bonjour-service";
import { isIP } from "node:net";
import { net } from "electron";

export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
  /** Filled after a fast status probe; false when the address did not answer. */
  reachable?: boolean;
  /** Round-trip time for the status probe, when reachable. */
  latencyMs?: number | null;
}

function serviceUrls(service: Service): string[] {
  const port = Number(service.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
  const tls = service.txt?.tls === "1";
  const scheme = tls ? "https" : "http";
  const urls = new Set<string>();

  for (const address of service.addresses ?? []) {
    if (isIP(address) !== 4 || address.startsWith("127.")) continue;
    urls.add(`${scheme}://${address}:${port}`);
  }

  // Some mDNS stacks expose a hostname but no resolved address. A `.local`
  // name is still useful to the desktop's system resolver.
  const host = String(service.host ?? "").trim();
  if (host && !host.startsWith("127.") && host !== "localhost") {
    urls.add(`${scheme}://${host}:${port}`);
  }
  return [...urls];
}

async function probe(url: string): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const started = performance.now();
  try {
    const response = await net.fetch(`${url}/api/server/status`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1_800),
    });
    return {
      reachable: response.ok,
      latencyMs: response.ok ? Math.max(1, Math.round(performance.now() - started)) : null,
    };
  } catch (error) {
    // The LAN listener uses a self-signed certificate. net.fetch cannot show
    // the app's trust prompt, but the window can; treat a certificate failure
    // as "found, verify on connect" rather than a dead address.
    const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (/cert|ssl|tls|authority/i.test(message)) {
      return { reachable: true, latencyMs: null };
    }
    return { reachable: false, latencyMs: null };
  }
}

/**
 * A bounded native mDNS browse plus a fast reachability probe. Multiple
 * interfaces and addresses are collapsed to the quickest reachable URL per
 * server, so the connection screen never offers a dead address first.
 */
export function discoverServers(options: { timeoutMs?: number } = {}): Promise<DiscoveredServer[]> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? 4_000);
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredServer>();
    const bonjour = new Bonjour(undefined, () => {});
    const browser = bonjour.find(
      { type: "plexy", protocol: "tcp" },
      (service: Service) => {
        const id = String(service.txt?.id ?? "");
        const name = String(service.name ?? "Plexy server").slice(0, 100);
        if (!id) return;
        for (const url of serviceUrls(service)) {
          found.set(url, { id, name, url });
        }
      },
    );
    const finish = () => {
      browser.stop();
      bonjour.destroy();
      void Promise.all(
        [...found.values()].map(async (server) => {
          const result = await probe(server.url);
          server.reachable = result.reachable;
          server.latencyMs = result.latencyMs;
        }),
      ).then(() => {
        // One entry per server id: prefer a reachable address, then latency.
        const byId = new Map<string, DiscoveredServer[]>();
        for (const server of found.values()) {
          const list = byId.get(server.id) ?? [];
          list.push(server);
          byId.set(server.id, list);
        }
        const best = [...byId.values()].map((list) =>
          [...list].sort((a, b) =>
            Number(b.reachable) - Number(a.reachable) ||
            (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER),
          )[0]!,
        );
        resolve(best.sort((a, b) =>
          Number(b.reachable) - Number(a.reachable) ||
          (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
        ));
      });
    };
    setTimeout(finish, timeoutMs);
  });
}
