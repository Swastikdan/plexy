import { X509Certificate } from "node:crypto";
import { app, dialog } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isIP } from "node:net";

/** Trust is per host and certificate. No global certificate validation bypass. */
export function installCertificateTrust(): void {
  const file = join(app.getPath("userData"), "trusted-servers.json");
  let trusted: Record<string, string> = {};
  try {
    trusted = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* first connection */
  }
  app.on(
    "certificate-error",
    (event, _contents, rawUrl, error, certificate, callback) => {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        callback(false);
        return;
      }
      const host = url.hostname;
      const privateIp =
        isIP(host) === 4 &&
        /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
      if (
        url.protocol !== "https:" ||
        (!privateIp && !host.endsWith(".local")) ||
        error !== "net::ERR_CERT_AUTHORITY_INVALID"
      ) {
        callback(false);
        return;
      }
      event.preventDefault();
      let fingerprint: string;
      try {
        fingerprint = new X509Certificate(certificate.data).fingerprint256;
      } catch {
        callback(false);
        return;
      }
      const saved = trusted[url.host];
      if (saved) {
        callback(saved === fingerprint);
        return;
      }
      void dialog
        .showMessageBox({
          type: "warning",
          title: "Verify your Plexy server",
          message: `Trust the server at ${url.host}?`,
          detail: `Compare this SHA-256 fingerprint with My account on your server computer before trusting it:\n\n${fingerprint}\n\nOnly continue if they match.`,
          buttons: ["Cancel", "Trust this server"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        .then((answer) => {
          if (answer.response !== 1) {
            callback(false);
            return;
          }
          trusted[url.host] = fingerprint;
          try {
            writeFileSync(file, JSON.stringify(trusted), { mode: 0o600 });
          } catch {
            callback(false);
            return;
          }
          callback(true);
        })
        .catch(() => callback(false));
    },
  );
}
