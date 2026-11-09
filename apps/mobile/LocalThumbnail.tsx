import React, { useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { View } from "react-native";
import type { VideoPlayer, VideoThumbnail } from "expo-video";

/** Decode one small preview on demand; never write converted video or pause playback. */
export function LocalThumbnail({ player, time }: { player: VideoPlayer; time: number }) {
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const cache = useRef(new Map<number, VideoThumbnail>());
  const request = useRef(0);
  const second = Math.floor(Math.max(0, time) / 2) * 2;
  useEffect(() => {
    const id = ++request.current;
    const cached = cache.current.get(second);
    if (cached) { setThumbnail(cached); return; }
    const timer = setTimeout(() => {
      void player.generateThumbnailsAsync(second, { maxWidth: 240, maxHeight: 136 }).then(images => {
        if (id !== request.current || !images[0]) return;
        cache.current.set(second, images[0]);
        while (cache.current.size > 24) cache.current.delete(cache.current.keys().next().value!);
        setThumbnail(images[0]);
      }).catch(() => { /* An unsupported preview must not interrupt playback. */ });
    }, 160);
    return () => { clearTimeout(timer); request.current++; };
  }, [player, second]);
  return thumbnail ? <View style={{ width: 120, height: 68, overflow: "hidden", borderRadius: 8,
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.4)", backgroundColor: "black" }}>
    <Image source={thumbnail} style={{ width: "100%", height: "100%" }} contentFit="cover" />
  </View> : null;
}
