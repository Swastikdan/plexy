import { expect, test } from "bun:test";
import {
  normalizeServerAddress,
  serverLabel,
} from "@/core/server/address";

test("server addresses normalize to one origin", () => {
  expect(normalizeServerAddress("192.168.1.20:8766")).toBe(
    "https://192.168.1.20:8766",
  );
  expect(normalizeServerAddress(" HTTPS://Plexy.local:8766/ ")).toBe(
    "https://plexy.local:8766",
  );
  expect(normalizeServerAddress("http://10.0.2.2:8765")).toBe(
    "http://10.0.2.2:8765",
  );
  expect(serverLabel({ address: "https://192.168.1.20:8766" })).toBe(
    "192.168.1.20:8766",
  );
});

test("server addresses reject credentials and unsupported schemes", () => {
  expect(() => normalizeServerAddress("")).toThrow("Enter the server address");
  expect(() => normalizeServerAddress("ftp://example.test")).toThrow(
    "must start with http",
  );
  expect(() => normalizeServerAddress("https://user:pass@example.test")).toThrow(
    "credentials",
  );
});
