import "reflect-metadata";
import {
  X509CertificateGenerator,
  SubjectAlternativeNameExtension,
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsagesExtension,
  KeyUsageFlags,
} from "@peculiar/x509";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname, networkInterfaces } from "node:os";
import { resolveDataDir } from "./paths";

export interface LanCertificate {
  cert: string;
  key: string;
  fingerprint: string;
}
let current: LanCertificate | null = null;
export function certificateInfo() {
  return current
    ? { fingerprint: current.fingerprint, certificate: current.cert }
    : null;
}
export async function lanCertificate(): Promise<LanCertificate> {
  const certFile =
    Bun.env.PLEXY_TLS_CERT || join(resolveDataDir(), "lan-certificate.pem");
  const keyFile =
    Bun.env.PLEXY_TLS_KEY || join(resolveDataDir(), "lan-key.pem");
  if (Boolean(Bun.env.PLEXY_TLS_CERT) !== Boolean(Bun.env.PLEXY_TLS_KEY))
    throw new Error("Set both PLEXY_TLS_CERT and PLEXY_TLS_KEY.");
  const ips = [
    ...new Set(
      Object.values(networkInterfaces())
        .flat()
        .filter((entry) => entry?.family === "IPv4" && !entry.internal)
        .map((entry) => entry!.address),
    ),
  ];
  let cert = existsSync(certFile) ? readFileSync(certFile, "utf8") : "";
  let key = existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "";
  const supplied = Boolean(Bun.env.PLEXY_TLS_CERT);
  const reusable = () => {
    try {
      const parsed = new X509Certificate(cert);
      return (
        Date.parse(parsed.validTo) > Date.now() + 86400000 &&
        ips.every((ip) => parsed.checkIP(ip))
      );
    } catch {
      return false;
    }
  };
  if ((!cert || !key || !reusable()) && !supplied) {
    const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
    const keys = await crypto.subtle.generateKey(algorithm, true, [
      "sign",
      "verify",
    ]);
    const certificate = await X509CertificateGenerator.createSelfSigned({
      name: "CN=Plexy Local Server",
      keys,
      signingAlgorithm: algorithm,
      serialNumber: Buffer.from(
        crypto.getRandomValues(new Uint8Array(16)),
      ).toString("hex"),
      notBefore: new Date(Date.now() - 300000),
      notAfter: new Date(Date.now() + 365 * 86400000),
      extensions: [
        new BasicConstraintsExtension(false, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"]),
        new SubjectAlternativeNameExtension([
          { type: "dns", value: "localhost" },
          { type: "dns", value: hostname() },
          { type: "ip", value: "127.0.0.1" },
          ...ips.map((value) => ({ type: "ip" as const, value })),
        ]),
      ],
    });
    cert = certificate.toString("pem");
    const raw = Buffer.from(
      await crypto.subtle.exportKey("pkcs8", keys.privateKey),
    );
    key = `-----BEGIN PRIVATE KEY-----\n${raw
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n")}\n-----END PRIVATE KEY-----\n`;
    writeFileSync(keyFile, key, { mode: 0o600 });
    chmodSync(keyFile, 0o600);
    writeFileSync(certFile, cert, { mode: 0o600 });
  }
  if (!cert || !key)
    throw new Error("The supplied LAN certificate or key is missing.");
  current = {
    cert,
    key,
    fingerprint: new X509Certificate(cert).fingerprint256,
  };
  return current;
}
