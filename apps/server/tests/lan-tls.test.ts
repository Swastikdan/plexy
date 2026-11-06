import { expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { lanCertificate } from "../src/lan-tls";
import { resolveDataDir } from "../src/paths";

test("LAN certificates persist, protect their private key, and establish real HTTPS", async () => {
  const first = await lanCertificate();
  const second = await lanCertificate();
  expect(second.fingerprint).toBe(first.fingerprint);
  expect(first.cert).not.toContain("PRIVATE KEY");
  const cert = new X509Certificate(first.cert);
  expect(cert.checkHost("localhost")).toBe("localhost");
  expect(cert.checkIP("127.0.0.1")).toBe("127.0.0.1");
  expect(statSync(join(resolveDataDir(), "lan-key.pem")).mode & 0o777).toBe(
    0o600,
  );
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: first.cert, key: first.key },
    fetch: () => Response.json({ secure: true }),
  });
  try {
    const response = await fetch(`https://127.0.0.1:${server.port}`, {
      tls: { rejectUnauthorized: false },
    });
    expect((await response.json()).secure).toBe(true);
    let rejected = false;
    try {
      await fetch(`https://127.0.0.1:${server.port}`);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  } finally {
    server.stop(true);
  }
});
