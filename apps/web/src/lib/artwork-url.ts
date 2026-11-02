import { getApiBase } from "../server-config";

/** Point API-served artwork at the selected Plexy server, including hosted web clients. */
export function artworkUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(src) || /^data:/i.test(src)) return src;
  return `${getApiBase()}${src.startsWith("/") ? src : `/${src}`}`;
}
