export type VideoContainer = "mp4" | "mkv" | "webm" | "avi" | "ts";

function ascii(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes.slice(0, 64)) text += String.fromCharCode(byte);
  return text.toLowerCase();
}

export function sniffContainer(
  bytes: Uint8Array,
): VideoContainer | "html" | "unknown" {
  const head = ascii(bytes);
  if (head.includes("<html") || head.includes("<!doctype")) return "html";
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "mkv";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  )
    return "avi";
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  )
    return "mp4";
  if (bytes[0] === 0x47) return "ts";
  return "unknown";
}

export function extensionFor(
  container: VideoContainer,
  filename: string,
) {
  if (container === "mkv" && /\.webm$/i.test(filename)) return "webm";
  return container;
}

export function validateContainerBytes(
  bytes: Uint8Array,
  filename: string,
): { container: VideoContainer; extension: string } {
  const container = sniffContainer(bytes);
  if (container === "html") {
    throw new Error("The source returned an error page instead of a video.");
  }
  if (container === "unknown") {
    throw new Error("The downloaded file is not a supported video container.");
  }
  return { container, extension: extensionFor(container, filename) };
}
