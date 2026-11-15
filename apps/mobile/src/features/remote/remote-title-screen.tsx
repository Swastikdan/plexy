import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ItemCard } from "@/core/library/catalog-api";
import { useClient } from "@/core/client/client-provider";
import { useResource } from "@/core/resources/use-resource";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { useColors } from "@/shared/theme";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import { SwipePager } from "@/shared/ui/swipe-pager";
import {
  ArrowLeft,
  Check,
  Film,
  Info,
  MoreHorizontal,
  Plus,
} from "@/shared/ui/icons";
import { TopFade } from "@/features/catalog/components/top-fade";
import { Hero } from "@/features/catalog/components/hero";
import { RecommendationsRow } from "@/features/catalog/components/recommendations-row";
import { CastRow } from "@/features/title/components/cast-row";
import { EpisodeCardView } from "@/features/title/components/episode-card-view";
import { SeasonTabs } from "@/features/title/components/season-tabs";
import { TitleActionBar } from "@/features/title/components/title-action-bar";
import { TitleMenuAction } from "@/features/title/components/title-menu-action";
import { TitleTabs } from "@/features/title/components/title-tabs";
import { useRemote } from "./remote-provider";
import { fetchDetail, fetchSeason, type RemoteMediaType } from "./lib/tmdb";
import { useRemoteNavigation } from "./lib/use-remote-navigation";
import { useRecommendations } from "./lib/use-recommendations";
import { toItemCard } from "./lib/view";

export function RemoteTitleScreen({
  mediaType,
  tmdbId,
  fallbackName,
  autoPlay = false,
}: {
  mediaType: RemoteMediaType;
  tmdbId: number;
  fallbackName?: string;
  autoPlay?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useRemoteNavigation();
  const reducedMotion = useReducedMotion();
  const { api } = useClient();
  const { save, isSaved } = useRemote();

  const detailScroll = useRef<ScrollView>(null);
  const detail = useResource(
    (signal) => fetchDetail(mediaType, tmdbId, signal),
    [mediaType, tmdbId],
    "remote-detail",
  );

  const [season, setSeason] = useState<number | null>(null);
  const [episode, setEpisode] = useState<number | null>(null);
  const [tab, setTab] = useState<"episodes" | "details">("episodes");
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const title = detail.value;
  const seasons = useMemo(() => title?.seasons ?? [], [title]);
  const selectedSeason = season ?? seasons[0]?.number ?? 1;

  const episodes = useResource(
    (signal) =>
      title?.mediaType === "tv" && seasons.length
        ? fetchSeason(tmdbId, selectedSeason, signal)
        : Promise.resolve([]),
    [seasons.length, selectedSeason, title?.mediaType, tmdbId],
    "remote-season",
  );

  const item = useMemo<ItemCard | null>(() => {
    if (!title) return null;
    const card = toItemCard(title, title.runtime);
    return fallbackName && !card.name ? { ...card, name: fallbackName } : card;
  }, [fallbackName, title]);
  const recommendations = useRecommendations({
    api,
    mediaType,
    tmdbId,
    online: true,
  });
  const saved = title ? isSaved(title) : false;
  const localMatch = useMemo(() => {
    if (!title) return null;
    return (
      api
        .titlesByTmdb()
        .get(`${title.mediaType}:${title.tmdbId}`) ?? null
    );
  }, [api, title]);
  const chosenEpisode = episode ?? episodes.value?.[0]?.number ?? null;

  const playEpisode = (
    seasonNumber: number,
    episodeNumber: number,
    displayName?: string,
  ) => {
    if (!title) return;
    router.push({
      pathname: "/player/remote",
      params: {
        mediaType: title.mediaType,
        tmdbId: String(title.tmdbId),
        season: title.mediaType === "tv" ? String(seasonNumber) : "",
        episode: title.mediaType === "tv" ? String(episodeNumber) : "",
        title: title.title,
        display:
          displayName ??
          (title.mediaType === "tv"
            ? `${title.title} · S${seasonNumber}E${episodeNumber}`
            : title.title),
      },
    });
  };

  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoPlay || autoOpened.current || !title) return;
    autoOpened.current = true;
    playEpisode(selectedSeason, chosenEpisode ?? 1);
    // The effect intentionally runs once per title; values are read at open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, title]);

  const toggleSaved = () => {
    if (!title || savedBusy) return;
    setSavedBusy(true);
    void save(title)
      .catch(() => setActionError("Could not update your library."))
      .finally(() => setSavedBusy(false));
  };

  if (!title && detail.loading) return <Loading />;
  if (!title) {
    return (
      <View className="flex-1 bg-background px-5 pt-16">
        <Notice
          kind="error"
          message={detail.error || "This title could not be loaded."}
          retry={detail.retry}
        />
      </View>
    );
  }
  if (!item) return <Loading />;

  const hasEpisodes = title.mediaType === "tv" && seasons.length > 0;

  const detailsPage = (
    <View className="gap-[18px]">
      <Text className="font-archivo-regular text-[14px] leading-[22px] text-foreground/80">
        {title.overview || "No synopsis is available."}
      </Text>
      <CastRow
        people={title.cast.map((member, index) => ({
          id: index,
          name: member.name,
          character: member.character,
          photo: member.photo,
        }))}
        api={api}
        canOpen={() => false}
        onSelect={() => {}}
      />
    </View>
  );

  const episodesPage = (
    <View className="gap-[18px] pt-3">
      {episodes.loading && !episodes.value ? (
        <Loading />
      ) : episodes.error ? (
        <Notice
          kind="error"
          message={episodes.error}
          retry={episodes.retry}
        />
      ) : (
        (episodes.value ?? []).map((entry) => (
          <EpisodeCardView
            key={`${selectedSeason}-${entry.number}`}
            artwork={entry.still ? { uri: entry.still } : undefined}
            title={entry.title || `Episode ${entry.number}`}
            overview={entry.overview || entry.airDate}
            episodeNumber={entry.number}
            duration={entry.runtime ? `${entry.runtime}:00` : null}
            onPress={() => {
              setEpisode(entry.number);
              playEpisode(selectedSeason, entry.number);
            }}
          />
        ))
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <TopFade />
      <Pressable
        onPress={navigation.back}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        className="absolute left-4 z-[99] h-10 w-10 items-center justify-center rounded-full border border-foreground/[0.15] bg-overlay/90 active:opacity-60"
        style={{ top: insets.top + 14 }}
        hitSlop={14}
      >
        <ArrowLeft size={22} color={colors.ink} strokeWidth={2} />
      </Pressable>

      <ScrollView
        ref={detailScroll}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
      >
        <Hero
          showOverview={false}
          hideActions
          item={item}
          actionLabel="Play"
          onOpen={() => playEpisode(selectedSeason, chosenEpisode ?? 1)}
        />

        <View className="gap-[18px] px-5 pt-5">
          {!!actionError && <Notice message={actionError} />}

          {hasEpisodes ? (
            <>
              <TitleTabs
                className="mb-1.5 mt-1"
                value={tab}
                tabs={[
                  { key: "episodes", label: "Episodes" },
                  { key: "details", label: "Cast & Details" },
                ]}
                onChange={(key) =>
                  setTab(key === "details" ? "details" : "episodes")
                }
              />

              {tab === "episodes" && (
                <View className="flex-row items-center justify-between">
                  <Text className="font-archivo-medium text-[12px] text-muted">
                    {episodes.value?.length ?? 0}{" "}
                    {(episodes.value?.length ?? 0) === 1
                      ? "episode"
                      : "episodes"}
                  </Text>
                </View>
              )}

              {tab === "episodes" && seasons.length > 0 && (
                <SeasonTabs
                  seasons={seasons.map((entry) => ({
                    number: entry.number,
                    label:
                      entry.number === 0
                        ? "Specials"
                        : entry.name || `Season ${entry.number}`,
                  }))}
                  value={selectedSeason}
                  onChange={(number) => {
                    setSeason(number);
                    setEpisode(null);
                  }}
                />
              )}

              <SwipePager
                autoHeight
                pageKeys={["episodes", "details"]}
                index={tab === "details" ? 1 : 0}
                onChange={(index) =>
                  setTab(index === 1 ? "details" : "episodes")
                }
                renderPage={(page) =>
                  page === 0 ? episodesPage : detailsPage
                }
              />
            </>
          ) : (
            <>
              <Text className="font-archivo-regular text-[14px] leading-[22px] text-foreground/80">
                {title.overview || "No synopsis is available."}
              </Text>
              <CastRow
                people={title.cast.map((member, index) => ({
                  id: index,
                  name: member.name,
                  character: member.character,
                  photo: member.photo,
                }))}
                api={api}
                canOpen={() => false}
                onSelect={() => {}}
              />
            </>
          )}
        </View>

        <View className="pt-5">
          <RecommendationsRow
            items={recommendations.items}
            api={api}
            onSelect={(recommended) => {
              const remoteTitle = recommendations.remoteByPublicId.get(
                recommended.publicId,
              );
              if (remoteTitle) {
                navigation.open(remoteTitle);
                return;
              }
              router.push({
                pathname: "/item/[id]",
                params: { id: recommended.publicId },
              });
            }}
          />
        </View>
      </ScrollView>

      <Pressable
        accessibilityLabel="More title actions"
        onPress={() => setMenuOpen(!menuOpen)}
        className="absolute right-5 z-[99] h-10 w-10 items-center justify-center rounded-full border border-foreground/[0.15] bg-overlay/90"
        style={{ top: insets.top + 14 }}
      >
        <MoreHorizontal size={22} color={colors.ink} />
      </Pressable>
      {menuOpen && (
        <Pressable
          accessibilityLabel="Close title actions"
          onPress={() => setMenuOpen(false)}
          className="absolute inset-0 z-[100] bg-black/30"
        />
      )}
      {menuOpen && (
        <View
          className="absolute right-5 z-[101] w-[236px] gap-2 rounded-2xl border border-border bg-surface p-3"
          style={{ top: insets.top + 66 }}
        >
          <TitleMenuAction
            icon={Info}
            label="Details"
            onPress={() => {
              setTab("details");
              setMenuOpen(false);
              detailScroll.current?.scrollTo({
                y: 540,
                animated: !reducedMotion,
              });
            }}
          />
          <TitleMenuAction
            icon={saved ? Check : Plus}
            label={saved ? "Remove from library" : "Add to library"}
            onPress={() => {
              toggleSaved();
              setMenuOpen(false);
            }}
          />
          {localMatch && (
            <TitleMenuAction
              icon={Film}
              label="Open local copy"
              onPress={() => {
                setMenuOpen(false);
                router.push({
                  pathname: "/item/[id]",
                  params: { id: localMatch.publicId },
                });
              }}
            />
          )}
        </View>
      )}

      <TitleActionBar
        label="Play"
        onPress={() => playEpisode(selectedSeason, chosenEpisode ?? 1)}
      />
    </View>
  );
}
