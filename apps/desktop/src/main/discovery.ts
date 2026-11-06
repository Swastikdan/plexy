import { Bonjour, type Service } from "bonjour-service";
import { isIP } from "node:net";

export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
}
/** A bounded native mDNS browse; discovered servers still require sign-in. */
export function discoverServers(): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredServer>();
    const bonjour = new Bonjour(undefined, () => {});
    const browser = bonjour.find(
      { type: "plexy", protocol: "tcp" },
      (service: Service) => {
        const address = service.addresses?.find(
          (ip) => isIP(ip) === 4 && !ip.startsWith("127."),
        );
        const id = String(service.txt?.id ?? "");
        if (!address || !id || !Number.isInteger(service.port)) return;
        // Untrusted mDNS data may supply a label but never a navigation scheme or path.
        found.set(id, {
          id,
          name: String(service.name).slice(0, 100),
          url: `${service.txt?.tls === "1" ? "https" : "http"}://${address}:${service.port}`,
        });
      },
    );
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve([...found.values()]);
    }, 3500);
  });
}
