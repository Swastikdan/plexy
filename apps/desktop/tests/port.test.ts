import { afterEach, expect, test } from "bun:test";
import { createServer, type AddressInfo, type Server } from "node:net";
import { getAvailablePort, isPortFree } from "@/main/port";

const servers: Server[] = [];

async function hold(host: string): Promise<number> {
  const server = createServer(() => {});
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function release(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => release(server)));
});

test("a port held on loopback is not chosen", async () => {
  const port = await hold("127.0.0.1");
  expect(await isPortFree(port)).toBe(false);
  expect(await getAvailablePort(port)).not.toBe(port);
});

test("a port held on the wildcard address is not chosen", async () => {
  const port = await hold("0.0.0.0");
  expect(await isPortFree(port)).toBe(false);
  expect(await getAvailablePort(port)).not.toBe(port);
});

test("a free port is reused so LAN bookmarks stay valid", async () => {
  const port = await hold("127.0.0.1");
  await release(servers.pop()!);
  expect(await isPortFree(port)).toBe(true);
  expect(await getAvailablePort(port)).toBe(port);
});
