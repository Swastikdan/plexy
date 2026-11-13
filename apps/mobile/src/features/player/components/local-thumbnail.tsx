import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { VideoPlayer } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useClient } from "@/core/client/client-provider";
// Only visited timestamps are decoded. JPEGs survive app restarts in private storage.
const directory = new Directory(Paths.document, "trickplay");
const pending = new Map<string, Promise<string>>();
let queue = Promise.resolve();
async function preview(
  player: VideoPlayer,
  second: number,
  sourceVersion: string,
): Promise<string> {
  const prefix = `${sourceVersion}-`;
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${prefix}${second}.jpg`);
  if (destination.exists && destination.size) return destination.uri;
  const existing = pending.get(destination.uri);
  if (existing) return existing;
  const job = queue.then(async () => {
    if (destination.exists && destination.size) return destination.uri;
    const thumbnails = await player.generateThumbnailsAsync(second, {
      maxWidth: 240,
      maxHeight: 136,
    });
    const thumbnail = thumbnails[0];
    if (!thumbnail) throw new Error("Preview unavailable");
    const context = ImageManipulator.manipulate(thumbnail);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      rendered = await context.renderAsync();
      const result = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.75,
      });
      await new File(result.uri).move(destination, { overwrite: true });
      // Keep at most 50 MB; prune oldest cached images, including changed source files.
      const images = directory
        .list()
        .filter((f): f is File => f instanceof File);
      let total = images.reduce((sum, f) => sum + f.size, 0);
      for (const file of images.sort(
        (a, b) => (a.modificationTime || 0) - (b.modificationTime || 0),
      )) {
        if (file.uri === destination.uri) continue;
        if (total <= 50 * 1024 * 1024) break;
        const size = file.size;
        file.delete();
        total -= size;
      }
      return destination.uri;
    } finally {
      rendered?.release();
      context.release();
      for (const image of thumbnails) image.release();
    }
  });
  pending.set(destination.uri, job);
  queue = job.then(
    () => {},
    () => {},
  );
  void job.finally(() => pending.delete(destination.uri)).catch(() => {});
  return job;
}
export function LocalThumbnail({
  player,
  time,
  fileId,
  width = 120,
  height = 68,
}: {
  player: VideoPlayer;
  time: number;
  fileId: number;
  width?: number;
  height?: number;
}) {
  const { api } = useClient();
  const sourceVersion = api.fileVersion(fileId);
  const [uri, setUri] = useState<string | null>(null);
  const wanted = useRef(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const second = Math.floor(Math.max(0, time) / 2) * 2;
  wanted.current = second;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    // Throttle by completion rather than debouncing every pointer move. Continuous
    // dragging must still produce images, and only the latest target is queued.
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      let previous = -1;
      while (alive.current && previous !== wanted.current) {
        const target = wanted.current;
        previous = target;
        try {
          const image = await preview(player, target, sourceVersion);
          if (alive.current) setUri(image);
        } catch {
          /* Keep the last useful preview if this timestamp cannot decode. */
        }
      }
    })().finally(() => {
      busy.current = false;
    });
  }, [player, second, sourceVersion]);
  return uri ? (
    <View
      className="overflow-hidden rounded-[10px] border-[1.5px] border-white/40 bg-black"
      style={{ width, height }}
    >
      <Image
        source={uri}
        style={{ width: "100%", height: "100%" }}
        contentFit="contain"
      />
    </View>
  ) : null;
}
