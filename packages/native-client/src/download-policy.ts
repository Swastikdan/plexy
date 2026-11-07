export function validateTransfer(
  resumeAt: number,
  status: number,
  headers: Record<string, string>,
  size: number,
) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  if (status < 200 || status >= 300)
    return status === 401
      ? "Reconnect to this server, then retry the download."
      : status === 503
        ? "Server conversion is busy. Retry later; generated downloads restart."
        : `Download failed (${status}). Retry to continue.`;
  if (
    resumeAt &&
    (status !== 206 ||
      !normalized["content-range"]?.startsWith(`bytes ${resumeAt}-`))
  )
    return "The source changed or could not resume safely. Retry downloads it from the beginning.";
  if (!size) return "The server returned an empty download.";
  const expected =
    status === 206
      ? Number(normalized["content-range"]?.split("/")[1])
      : Number(normalized["content-length"]);
  if (expected > 0 && size !== expected)
    return "The downloaded file is incomplete. Retry to continue.";
  return null;
}
