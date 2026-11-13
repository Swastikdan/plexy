export function isCompleteApk(size: number | undefined, expectedSize: number) {
  return size !== undefined && size > 0 && expectedSize > 0 && size === expectedSize;
}

export function validateApkDownload(status: number | undefined, size: number | undefined, expectedSize: number) {
  if (status === undefined || status < 200 || status >= 300)
    throw new Error(`Update download failed${status ? ` (HTTP ${status})` : ""}. Please retry.`);
  if (!isCompleteApk(size, expectedSize))
    throw new Error("The update download is incomplete. Please retry before installing.");
}
