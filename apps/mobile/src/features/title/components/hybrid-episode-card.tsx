import type { LocalCatalog } from "@/core/library/catalog-api";
import type { HybridEpisode } from "@/features/remote/lib/hybrid-episodes";
import { EpisodeCardView } from "./episode-card-view";

/**
 * One row in a hybrid season: downloaded episodes keep the local play,
 * watched and selection actions; missing episodes open the online source.
 */
export function HybridEpisodeCard({
  episode,
  api,
  watched = false,
  progress = null,
  selecting = false,
  selected = false,
  disabled = false,
  onPress,
  onLongPress,
  onToggleWatched,
}: {
  episode: HybridEpisode;
  api: Pick<LocalCatalog, "image">;
  watched?: boolean;
  progress?: number | null;
  selecting?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onToggleWatched?: () => void;
}) {
  return (
    <EpisodeCardView
      artwork={episode.artwork ? api.image(episode.artwork) : undefined}
      title={episode.title}
      overview={episode.overview}
      episodeNumber={episode.number}
      duration={episode.runtime ? `${episode.runtime}:00` : null}
      progress={progress}
      watched={watched}
      online={Boolean(episode.remote)}
      selecting={selecting}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onToggleWatched={onToggleWatched}
    />
  );
}
