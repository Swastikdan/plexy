import { describe, expect, test } from "bun:test";
import {
  connectionError,
  isLoopbackHost,
  isPrivateHost,
  requiresSecureLanResolution,
} from "../src/lan-policy";
describe("LAN address and error handling", () => {
  test("upgrades the reported LAN address rather than sending cleartext credentials", () => {
    expect(requiresSecureLanResolution("http://192.168.1.240:8765")).toBe(true);
    expect(requiresSecureLanResolution("http://192.168.1.240:8766")).toBe(true);
    expect(requiresSecureLanResolution("https://192.168.1.240:8766")).toBe(
      false,
    );
    expect(requiresSecureLanResolution("http://localhost:8765")).toBe(false);
    expect(requiresSecureLanResolution("http://127.0.0.1:8765")).toBe(false);
    expect(requiresSecureLanResolution("http://[::1]:8765")).toBe(false);
    // A public HTTP input is also resolved/rejected natively, never fetched with credentials.
    expect(requiresSecureLanResolution("http://public.example")).toBe(true);
  });
  test("distinguishes private networks from public addresses without prefix confusion", () => {
    for (const host of [
      "192.168.1.240",
      "10.0.2.2",
      "172.16.0.1",
      "172.31.255.255",
      "nas.local",
      "[fd00::1]",
    ])
      expect(isPrivateHost(host)).toBe(true);
    for (const host of [
      "192.168.1.240.attacker.example",
      "172.32.0.1",
      "8.8.8.8",
      "192.168.999.1",
    ])
      expect(isPrivateHost(host)).toBe(false);
    expect(isLoopbackHost("localhost.attacker.example")).toBe(false);
  });
  test("turns the reported Java failures into actionable connection messages", () => {
    expect(
      connectionError(
        new Error(
          "fetch failed: javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.",
        ),
      ),
    ).toContain("fingerprint");
    expect(
      connectionError(
        new Error(
          "fetch failed: java.net.UnknownServiceException: CLEARTEXT communication to 192.168.1.240 not permitted by network security policy",
        ),
      ),
    ).toContain("HTTPS");
    expect(connectionError(new Error("Network request failed"))).toContain(
      "LAN access",
    );
  });
});
