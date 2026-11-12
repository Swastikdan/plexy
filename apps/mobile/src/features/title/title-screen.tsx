import { useRouter } from "expo-router";
import { Button as NativeButton } from "heroui-native/button";
import React,{ useRef,useState } from "react";
import {
Alert,
Linking,
Pressable,
ScrollView,
Text,
View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard } from "@/core/library/catalog-api";
import { localLibrary } from "@/core/library/local-runtime";
import { useResource } from "@/core/resources/use-resource";
import { useOnline } from "@/shared/hooks/use-online";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { triggerHaptic } from "@/shared/lib/haptics";
import { cn } from "@/shared/lib/cn";
import { colors,control } from "@/shared/theme";
import {
ArrowLeft,
Check,
Film,
Info,
MoreHorizontal,
Play,
Trash2,
} from "@/shared/ui/icons";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import { Hero } from "@/features/catalog/components/hero";
import { TitleBrowser } from "@/features/catalog/components/title-browser";
import { TopFade } from "@/features/catalog/components/top-fade";
import { playbackAction } from "@/features/catalog/lib/playback-action";
import { CastRow } from "./components/cast-row";
import { EpisodeCard } from "./components/episode-card";
import { TitleMenuAction } from "./components/title-menu-action";

export function TitleScreen({
  id,
  back,
  play,
}: {
  id: string | number;
  back: () => void;
  play: (fileId: number) => void;
}) {
  const { api, platform, progress } = useClient();
  const insets = useSafeAreaInsets();
  const data = useResource((signal) => api.detail(id, signal), [api, id]);
  const router = useRouter();
  const online = useOnline();
  const detailScroll = useRef<ScrollView>(null);
  const reducedMotion = useReducedMotion();
  const [personName, setPersonName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"episodes" | "details">(
    "episodes",
  );
  const [tabFocus, setTabFocus] = useState<string | null>(null);
  const [seasonFocus, setSeasonFocus] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [overrideWatched, setOverrideWatched] = useState<boolean | null>(null);
  const [episodesWatchedOverride, setEpisodesWatchedOverride] = useState<
    Record<number, boolean>
  >({});
  const detail = data.value;
  const item = detail?.item;
  const titlesByPerson = React.useMemo(() => {
    const cards = new Map(localLibrary.cards().map((card) => [card.id, card]));
    const groups = new Map<string, Map<number, ItemCard>>();
    for (const record of localLibrary.state.records) {
      const card = cards.get(record.card.parentId ?? record.id);
      if (!card) continue;
      for (const person of record.cast) {
        const titles = groups.get(person.name) ?? new Map<number, ItemCard>();
        titles.set(card.id, card);
        groups.set(person.name, titles);
      }
    }
    return new Map(
      [...groups].map(([name, titles]) => [name, [...titles.values()]]),
    );
  }, [detail]);
  const personTitles = (name: string) => titlesByPerson.get(name) ?? [];
  const isSeriesWatched = overrideWatched ?? Boolean(item?.watch?.played);
  async function watched() {
    if (!item) return;
    const nextPlayed = !isSeriesWatched;
    setOverrideWatched(nextPlayed);
    // Optimistically update all episodes to completed (or unwatched)
    const newOverrides: Record<number, boolean> = {};
    if (detail?.episodes) {
      detail.episodes.forEach((ep: any) => {
        newOverrides[ep.id] = nextPlayed;
      });
      setEpisodesWatchedOverride((prev) => ({ ...prev, ...newOverrides }));
    }
    try {
      await progress.flush(api);
      if (nextPlayed) {
        if (detail?.episodes) {
          for (const ep of detail.episodes) {
            const dur = ep.runtime ? ep.runtime * 60 : 3600;
            await progress.record({
              itemId: ep.id,
              position: dur,
              duration: dur,
              played: true,
              updatedAt: Date.now(),
            });
          }
        }
        await progress.record({
          itemId: item.id,
          position: 100,
          duration: 100,
          played: true,
          updatedAt: Date.now(),
        });
      } else {
        if (detail?.episodes) {
          for (const ep of detail.episodes) {
            await progress.forget(ep.id);
            await api.watched(ep.id, false).catch(() => {});
          }
        }
        await progress.forget(item.id);
        await api.watched(item.id, false).catch(() => {});
      }
      if (nextPlayed) {
        await api.watched(item.id, true);
      }
      data.retry();
    } catch (e) {
      {
        setActionError(
          e instanceof Error ? e.message : "Could not update watched state.",
        );
      }
    }
  }
  async function toggleEpisodeWatched(ep: any) {
    const currentEpPlayed =
      episodesWatchedOverride[ep.id] ??
      (progress.latest(ep.id)?.played || Boolean(ep.watch?.played));
    const nextPlayed = !currentEpPlayed;
    setEpisodesWatchedOverride((prev) => ({ ...prev, [ep.id]: nextPlayed }));
    try {
      if (nextPlayed) {
        const dur = ep.runtime ? ep.runtime * 60 : 3600;
        await progress.record({
          itemId: ep.id,
          position: dur,
          duration: dur,
          played: true,
          updatedAt: Date.now(),
        });
        await api.watched(ep.id, true);
      } else {
        await progress.forget(ep.id);
        await api.watched(ep.id, false);
      }
      data.retry();
    } catch {}
  }
  const detailAction = playbackAction(item ?? {}, detail?.episodes ?? []);
  function getFirstPlayableFileId() {
    return detail?.file?.fileId ?? detailAction.fileId;
  }
  const selectedSeason = season ?? detail?.seasons?.[0]?.number;
  const hasEpisodes = Boolean(detail?.episodes?.length);
  return (
    <View className="flex-1 bg-background">
      <TopFade />
      {/* Floating Back button pinned at top-left */}
      <Pressable
        onPress={back}
        className="absolute left-4 z-[99] h-10 w-10 items-center justify-center rounded-full border border-white/[0.15] bg-black/[0.65] active:opacity-60"
        style={{ top: insets.top + 14 }}
        hitSlop={14}
      >
        <ArrowLeft size={22} color="#fff" strokeWidth={2} />
      </Pressable>

      <ScrollView
        ref={detailScroll}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          { paddingBottom: 48 },
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {data.loading && !detail ? (
          <View className="p-8">
            <Loading />
          </View>
        ) : data.error && !detail ? (
          <View className="p-6">
            <Notice message={data.error} retry={data.retry} />
          </View>
        ) : (
          detail &&
          item && (
            <>
              {/* Hero section */}
              <Hero
                hideActions
                item={item}
                logo={
                  "logo" in detail && (detail as any).logo
                    ? (detail as any).logo
                    : item.logo
                }
                actionLabel={detailAction.label}
                disabled={!getFirstPlayableFileId()}
                onOpen={() => {
                  const fileId = getFirstPlayableFileId();
                  if (fileId) play(fileId);
                }}
              />

              <View className="gap-[18px] px-5 pt-5">
                {!!actionError && <Notice message={actionError} />}

                {/* If TV show with episodes, display Tab Selector: Episodes | Cast & Details */}
                {hasEpisodes ? (
                  <>
                    <View className="mb-1.5 mt-1 flex-row gap-1.5 rounded-full bg-surface p-1">
                      <Pressable
                        accessibilityRole="tab"
                        accessibilityState={{
                          selected: detailTab === "episodes",
                        }}
                        onPress={() => setDetailTab("episodes")}
                        onFocus={() => setTabFocus("episodes")}
                        onBlur={() => setTabFocus(null)}
                        className={cn(
                          "min-h-11 flex-1 items-center justify-center rounded-full px-4 py-2.5",
                          detailTab === "episodes"
                            ? "bg-foreground"
                            : "bg-transparent",
                          tabFocus === "episodes" && "border-2 border-accent",
                        )}
                      >
                        <Text
                          className={cn(
                            "text-[15px]",
                            detailTab === "episodes"
                              ? "font-archivo-bold text-black"
                              : "font-archivo-medium text-muted",
                          )}
                        >
                          Episodes
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="tab"
                        accessibilityState={{
                          selected: detailTab === "details",
                        }}
                        onPress={() => setDetailTab("details")}
                        onFocus={() => setTabFocus("details")}
                        onBlur={() => setTabFocus(null)}
                        className={cn(
                          "min-h-11 flex-1 items-center justify-center rounded-full px-4 py-2.5",
                          detailTab === "details"
                            ? "bg-foreground"
                            : "bg-transparent",
                          tabFocus === "details" && "border-2 border-accent",
                        )}
                      >
                        <Text
                          className={cn(
                            "text-[15px]",
                            detailTab === "details"
                              ? "font-archivo-bold text-black"
                              : "font-archivo-medium text-muted",
                          )}
                        >
                          Cast & Details
                        </Text>
                      </Pressable>
                    </View>

                    {detailTab === "episodes" ? (
                      <>
                        {!!detail.seasons?.length && (
                          <ScrollView
                            horizontal
                            accessibilityRole="tablist"
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{ gap: 28, paddingBottom: 2 }}
                          >
                            {detail.seasons.map((s: any) => {
                              const active = selectedSeason === s.number;
                              const label =
                                s.number === 0
                                  ? "Specials"
                                  : `Season ${s.number}`;
                              return (
                                <Pressable
                                  key={s.number}
                                  accessibilityRole="tab"
                                  accessibilityLabel={label}
                                  accessibilityState={{ selected: active }}
                                  onPress={() => {
                                    triggerHaptic("selection");
                                    setSeason(s.number);
                                  }}
                                  onFocus={() => setSeasonFocus(s.number)}
                                  onBlur={() => setSeasonFocus(null)}
                                  className={cn(
                                    "min-h-12 justify-center border-b-2 py-3 active:opacity-65",
                                    // Mutually exclusive states: uniwind
                                    // resolves conflicting border-b-*/text-*
                                    // classes by stylesheet order, not
                                    // className order. Border weight and
                                    // padding never change, so the pill keeps
                                    // its exact height.
                                    active
                                      ? "border-b-white"
                                      : seasonFocus === s.number
                                        ? "border-b-accent"
                                        : "border-b-transparent",
                                  )}
                                >
                                  <Text
                                    className={cn(
                                      // The pill is sized by its label, so
                                      // the font weight must stay identical
                                      // in both states — switching to bold
                                      // widens the active label and shoves
                                      // every following pill sideways. Only
                                      // colour and the underline change.
                                      "text-[17px] leading-[22px] font-archivo-medium tracking-[0.1px]",
                                      active ? "text-white" : "text-muted",
                                    )}
                                  >
                                    {label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                        )}

                        {/* Download whole season button */}

                        {/* Episodes list */}
                        {detail.episodes
                          ?.filter(
                            (e: any) =>
                              selectedSeason == null ||
                              e.seasonNumber === selectedSeason,
                          )
                          .map((ep: any) => {
                            const isEpWatched =
                              episodesWatchedOverride[ep.id] ??
                              (progress.latest(ep.id)?.played ||
                                Boolean(ep.watch?.played));
                            return (
                              <EpisodeCard
                                key={ep.id}
                                ep={{
                                  ...ep,
                                  watch: {
                                    ...ep.watch,
                                    played: isEpWatched,
                                    position: isEpWatched
                                      ? ep.watch?.duration ||
                                        (ep.runtime ? ep.runtime * 60 : 3600)
                                      : ep.watch?.position || 0,
                                  },
                                }}
                                api={api}
                                platform={platform}
                                play={play}
                                item={item}
                                onToggleWatched={toggleEpisodeWatched}
                              />
                            );
                          })}
                      </>
                    ) : (
                      <>
                        {/* Overview */}
                        <Text className="font-archivo-regular text-[14px] leading-[22px] text-[#f0f0f0]/[0.78]">
                          {detail.metadata?.overview ||
                            item.overview ||
                            "No synopsis is available."}
                        </Text>

                        {/* File quality info */}
                        {detail.file &&
                          (detail.file.height ||
                            detail.file.videoCodec ||
                            detail.file.hdr) && (
                            <Text className="self-start rounded-lg bg-accent/20 px-3 py-2 font-archivo-medium text-[12px] tracking-[0.3px] text-accent">
                              {[
                                detail.file.height
                                  ? `${detail.file.height >= 2160 ? "4K" : detail.file.height >= 720 ? "HD" : "SD"} · ${detail.file.height}p`
                                  : null,
                                (detail.file as any).videoCodec?.toUpperCase(),
                                (detail.file as any).hdr,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          )}

                        {/* Cast */}
                        <CastRow
                          people={detail.cast ?? []}
                          api={api}
                          canOpen={(name) => personTitles(name).length > 0}
                          onSelect={setPersonName}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* Movie overview */}
                    <Text className="font-archivo-regular text-[14px] leading-[22px] text-[#f0f0f0]/[0.78]">
                      {detail.metadata?.overview ||
                        item.overview ||
                        "No synopsis is available."}
                    </Text>

                    {/* File quality info */}
                    {detail.file &&
                      (detail.file.height ||
                        detail.file.videoCodec ||
                        detail.file.hdr) && (
                        <Text className="self-start rounded-lg bg-accent/20 px-3 py-2 font-archivo-medium text-[12px] tracking-[0.3px] text-accent">
                          {[
                            detail.file.height
                              ? `${detail.file.height >= 2160 ? "4K" : detail.file.height >= 720 ? "HD" : "SD"} · ${detail.file.height}p`
                              : null,
                            (detail.file as any).videoCodec?.toUpperCase(),
                            (detail.file as any).hdr,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      )}

                    {/* Movie Cast */}
                    <CastRow
                      people={detail.cast ?? []}
                      api={api}
                      canOpen={(name) => personTitles(name).length > 0}
                      onSelect={setPersonName}
                    />
                  </>
                )}
              </View>
            </>
          )
        )}
      </ScrollView>
      <TitleBrowser
        title={personName}
        items={personName ? personTitles(personName) : []}
        close={() => setPersonName(null)}
        open={(id) =>
          router.push({ pathname: "/item/[id]", params: { id: String(id) } })
        }
      />
      {item && detail && (
        <>
          <Pressable
            accessibilityLabel="More title actions"
            onPress={() => setMenuOpen(!menuOpen)}
            className="absolute right-5 z-[99] h-10 w-10 items-center justify-center rounded-full border border-white/[0.15] bg-black/[0.65]"
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
                  setDetailTab("details");
                  setMenuOpen(false);
                  detailScroll.current?.scrollTo({
                    y: 540,
                    animated: !reducedMotion,
                  });
                }}
              />
              <TitleMenuAction
                icon={Check}
                label={isSeriesWatched ? "Mark unwatched" : "Mark finished"}
                onPress={() => {
                  void watched();
                  setMenuOpen(false);
                }}
              />
              <TitleMenuAction
                destructive
                icon={Trash2}
                label="Delete from device"
                onPress={() =>
                  Alert.alert(
                    "Delete title?",
                    "This permanently deletes the video files from your device.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => {
                          void api
                            .deleteItem(item.id)
                            .then(back)
                            .catch((e) => setActionError(String(e)));
                        },
                      },
                    ],
                  )
                }
              />
            </View>
          )}
          <View
            className="absolute bottom-0 left-0 right-0 flex-row gap-3 border-t border-t-border bg-background px-5 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 14) }}
          >
            <NativeButton
              className="flex-1 justify-center rounded-full bg-white px-5"
              style={{ height: control.height, minHeight: control.height }}
              size="lg"
              accessibilityLabel={detailAction.accessibilityLabel}
              isDisabled={!getFirstPlayableFileId()}
              onPress={() => {
                const fileId = getFirstPlayableFileId();
                if (fileId) play(fileId);
              }}
            >
              <Play size={22} color={colors.canvas} fill={colors.canvas} />
              <View style={{ alignItems: "center", flexShrink: 1 }}>
                <NativeButton.Label className="text-black">
                  {detailAction.label}
                </NativeButton.Label>
              </View>
            </NativeButton>
            {detail.trailer?.provider?.toLowerCase() === "youtube" && (
              <NativeButton
                variant="secondary"
                size="lg"
                isIconOnly
                accessibilityLabel="Watch trailer"
                className="rounded-full bg-surface"
                style={{ width: control.height, height: control.height }}
                isDisabled={!online}
                onPress={() => {
                  void Linking.openURL(
                    `https://www.youtube.com/watch?v=${encodeURIComponent(detail.trailer!.key)}`,
                  ).catch((e) => setActionError(String(e)));
                }}
              >
                <Film size={22} color={colors.ink} />
              </NativeButton>
            )}
          </View>
        </>
      )}
    </View>
  );
}
