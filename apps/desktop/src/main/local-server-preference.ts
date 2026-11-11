import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Defaults to bundled mode; malformed or missing preferences cannot prevent startup. */
export function readLocalServerEnabled(directory: string): boolean {
  try {
    return (
      JSON.parse(readFileSync(join(directory, "local-server.json"), "utf8"))
        .enabled !== false
    );
  } catch {
    return true;
  }
}
export function writeLocalServerEnabled(
  directory: string,
  enabled: boolean,
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "local-server.json"),
    JSON.stringify({ enabled }),
  );
}
