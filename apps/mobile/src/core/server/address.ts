/** Normalize user input into the origin used by every server request. */
export function normalizeServerAddress(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Enter the server address.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value))
    throw new Error("The server address must start with http:// or https://.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That server address is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("The server address must use https://.");
  if (!url.hostname) throw new Error("The server address is missing a host.");
  if (url.username || url.password)
    throw new Error("Do not put credentials in the server address.");
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function serverLabel(session: { address: string }) {
  try {
    return new URL(session.address).host;
  } catch {
    return session.address;
  }
}
