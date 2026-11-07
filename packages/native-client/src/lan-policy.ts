export function isLoopbackHost(host: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    host.toLowerCase(),
  );
}
export function isPrivateHost(host: string) {
  if (isLoopbackHost(host)) return true;
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  )
    return (
      parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  return (
    host.endsWith(".local") ||
    (!host.includes(".") && !host.includes(":")) ||
    /^\[?(fc|fd|fe80:)/i.test(host)
  );
}
export function requiresSecureLanResolution(base: string) {
  const url = new URL(base);
  return url.protocol === "http:" && !isLoopbackHost(url.hostname);
}
export function connectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /Trust anchor|SSLHandshake|CertPathValidator|certificate verify/i.test(
      message,
    )
  )
    return "This local server uses a certificate Android does not yet trust. Review its fingerprint and approve this server to connect securely.";
  if (/CLEARTEXT|network security policy/i.test(message))
    return "Use the server’s HTTPS LAN address. Plexy will resolve a local HTTP address to HTTPS before signing in.";
  if (/Network request failed|fetch failed/i.test(message))
    return "Could not reach the server. Check the address, enable LAN access on Plexy Server and make sure both devices are on the same network.";
  return message;
}
