import { useRouter } from "expo-router";
import { Button as NativeButton } from "heroui-native/button";
import React,{ useRef,useState } from "react";
import {
Alert,
Linking,
Pressable,
ScrollView,
StyleSheet,
Text,
View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "../../core/client/client-provider";
import type { ItemCard } from "../../core/library/catalog-api";
import { localLibrary } from "../../core/library/local-runtime";
import { useResource } from "../../core/resources/use-resource";
import { useOnline } from "../../shared/hooks/use-online";
import { useReducedMotion } from "../../shared/hooks/use-reduced-motion";
import { triggerHaptic } from "../../shared/lib/haptics";
import { colors,control,fonts } from "../../shared/theme";
import {
ArrowLeft,
Check,
Film,
Info,
MoreHorizontal,
Play,
Trash2,
} from "../../shared/ui/icons";
import { Loading } from "../../shared/ui/loading";
import { Notice } from "../../shared/ui/notice";
import { Hero } from "../catalog/components/hero";
import { TitleBrowser } from "../catalog/components/title-browser";
import { TopFade } from "../catalog/components/top-fade";
import { playbackAction } from "../catalog/lib/playback-action";
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
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <TopFade />
      {/* Floating Back button pinned at top-left */}
      <Pressable
        onPress={back}
        style={({ pressed }) => [
          styles.detailBack,
          { top: insets.top + 14 },
          pressed && { opacity: 0.6 },
        ]}
        hitSlop={14}
      >
        <ArrowLeft size={22} color="#fff" strokeWidth={2} />
      </Pressable>

      <ScrollView
        ref={detailScroll}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.detailContainer,
          { paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {data.loading && !detail ? (
          <View style={{ padding: 32 }}>
            <Loading />
          </View>
        ) : data.error && !detail ? (
          <View style={{ padding: 24 }}>
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

              <View style={[styles.detailBody]}>
                {!!actionError && <Notice message={actionError} />}

                {/* If TV show with episodes, display Tab Selector: Episodes | Cast & Details */}
                {hasEpisodes ? (
                  <>
                    <View style={styles.detailTabBar}>
                      <Pressable
                        accessibilityRole="tab"
                        accessibilityState={{
                          selected: detailTab === "episodes",
                        }}
                        onPress={() => setDetailTab("episodes")}
                        onFocus={() => setTabFocus("episodes")}
                        onBlur={() => setTabFocus(null)}
                        style={[
                          styles.detailTabItem,
                          detailTab === "episodes" &&
                            styles.detailTabItemActive,
                          tabFocus === "episodes" &&
                            styles.detailTabItemFocusedTv,
                        ]}
                      >
                        <Text
                          style={[
                            styles.detailTabItemText,
                            detailTab === "episodes" &&
                              styles.detailTabItemTextActive,
                          ]}
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
                        style={[
                          styles.detailTabItem,
                          detailTab === "details" && styles.detailTabItemActive,
                          tabFocus === "details" &&
                            styles.detailTabItemFocusedTv,
                        ]}
                      >
                        <Text
                          style={[
                            styles.detailTabItemText,
                            detailTab === "details" &&
                              styles.detailTabItemTextActive,
                          ]}
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
                            contentContainerStyle={styles.seasonTabs}
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
                                  style={({ pressed }) => [
                                    styles.seasonTab,
                                    active && styles.seasonTabActive,
                                    seasonFocus === s.number &&
                                      styles.seasonTabFocused,
                                    pressed && { opacity: 0.65 },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.seasonTabText,
                                      active && styles.seasonTabTextActive,
                                    ]}
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
                        <Text style={styles.detailOverview}>
                          {detail.metadata?.overview ||
                            item.overview ||
                            "No synopsis is available."}
                        </Text>

                        {/* File quality info */}
                        {detail.file &&
                          (detail.file.height ||
                            detail.file.videoCodec ||
                            detail.file.hdr) && (
                            <Text style={styles.detailQuality}>
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
                    <Text style={styles.detailOverview}>
                      {detail.metadata?.overview ||
                        item.overview ||
                        "No synopsis is available."}
                    </Text>

                    {/* File quality info */}
                    {detail.file &&
                      (detail.file.height ||
                        detail.file.videoCodec ||
                        detail.file.hdr) && (
                        <Text style={styles.detailQuality}>
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
            style={[
              styles.detailBack,
              { left: undefined, right: 20, top: insets.top + 14 },
            ]}
          >
            <MoreHorizontal size={22} color={colors.ink} />
          </Pressable>
          {menuOpen && (
            <Pressable
              accessibilityLabel="Close title actions"
              onPress={() => setMenuOpen(false)}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "rgba(0,0,0,0.3)", zIndex: 100 },
              ]}
            />
          )}
          {menuOpen && (
            <View
              style={{
                position: "absolute",
                right: 20,
                top: insets.top + 66,
                zIndex: 101,
                width: 236,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
                padding: 12,
                borderRadius: 16,
                gap: 8,
              }}
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
            className="absolute bottom-0 left-0 right-0 flex-row gap-3 px-5 pt-3"
            style={{
              paddingBottom: Math.max(insets.bottom, 14),
              backgroundColor: colors.canvas,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
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
              <Play size={20} color={colors.canvas} />
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
                className="rounded-full bg-panel"
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

const styles = StyleSheet.create({
detailContainer: {
    paddingBottom: 48,
  },
detailBack: {
    position: "absolute",
    top: 14,
    left: 16,
    zIndex: 99,
    width: 40,
    height: 40,
    borderRadius: control.radius,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
detailBody: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 18,
  },
detailOverview: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: "rgba(240,240,240,0.78)",
    lineHeight: 22,
  },
detailQuality: {
    backgroundColor: colors.strong,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.brandLight,
    letterSpacing: 0.3,
  },
detailTabBar: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    backgroundColor: colors.surface,
    borderRadius: control.radius,
    marginTop: 4,
    marginBottom: 6,
  },
detailTabItem: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: control.radius,
  },
detailTabItemActive: { backgroundColor: colors.ink },
detailTabItemText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.muted,
  },
detailTabItemTextActive: { fontFamily: fonts.bold, color: colors.canvas },
detailTabItemFocusedTv: { borderWidth: 2, borderColor: colors.brandLight },
seasonTabs: { gap: 28, paddingBottom: 2 },
seasonTab: {
    minHeight: 48,
    justifyContent: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
seasonTabActive: { borderBottomColor: colors.ink },
seasonTabText: {
    fontFamily: fonts.medium,
    fontSize: 17,
    color: colors.muted,
  },
seasonTabTextActive: { fontFamily: fonts.bold, color: colors.ink },
seasonTabFocused: { borderBottomColor: colors.brandLight }
});
