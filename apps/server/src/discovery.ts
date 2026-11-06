import { Bonjour } from "bonjour-service";
import { hostname } from "node:os";
import { getServerId } from "./server-identity";
import { log } from "./logger";

/** Discovery advertises identity and transport only, never accounts or credentials. */
export function advertiseServer(port: number, secure: boolean): () => void {
  const bonjour = new Bonjour(undefined, (error: Error) =>
    log.warn("server", "Local discovery unavailable", {
      message: error.message,
    }),
  );
  const service = bonjour.publish({
    name: `Plexy on ${hostname()}`,
    type: "plexy",
    protocol: "tcp",
    port,
    txt: { id: getServerId(), tls: secure ? "1" : "0", version: "1" },
  });
  service.on("error", (error) =>
    log.warn("server", "Could not advertise this server", {
      message: String(error),
    }),
  );
  return () => {
    service.stop();
    bonjour.destroy();
  };
}
