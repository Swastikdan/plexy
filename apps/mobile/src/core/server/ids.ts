/** Server ids are offset so a merged catalog never confuses them with device ids. */
export const SERVER_ID_OFFSET = 1_000_000_000;

export function serverItemId(id: number) {
  return id + SERVER_ID_OFFSET;
}

export function serverFileId(id: number) {
  return id + SERVER_ID_OFFSET;
}

export function isServerId(id: number) {
  return Number.isSafeInteger(id) && id >= SERVER_ID_OFFSET;
}

/** Convert a rendered server id back to the server's own database id. */
export function serverSourceId(id: number) {
  return isServerId(id) ? id - SERVER_ID_OFFSET : id;
}
