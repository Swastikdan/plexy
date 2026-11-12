type PlayableTitle = {
  kind?: string;
  fileId?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  watch?: { position?: number; played?: boolean } | null;
};

export function playbackAction(
  item: PlayableTitle,
  episodes: PlayableTitle[] = [],
) {
  const available = episodes
    .filter((e) => e.fileId)
    .sort(
      (a, b) =>
        (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1) ||
        (a.episodeNumber ?? 1) - (b.episodeNumber ?? 1),
    );
  const target =
    (item.fileId
      ? available.find((e) => e.fileId === item.fileId)
      : undefined) ??
    available.find((e) => !e.watch?.played) ??
    available[0] ??
    item;
  const label = target.watch?.played
    ? "Watch again"
    : (target.watch?.position ?? 0) > 0
      ? "Continue watching"
      : "Start watching";
  const context =
    target.episodeNumber != null
      ? [
          target.seasonNumber === 0
            ? "Specials"
            : target.seasonNumber != null
              ? `Season ${target.seasonNumber}`
              : null,
          `Episode ${target.episodeNumber}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  return {
    label,
    context,
    accessibilityLabel: [label, context].filter(Boolean).join(", "),
    fileId: target.fileId ?? null,
  };
}
