import { Screen } from "@/shared/ui/screen";
import { useRouter } from "expo-router";
import { SectionList, Text, View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import { familyAllows } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { useResource } from "@/core/resources/use-resource";
import { useRemote } from "@/features/remote/remote-provider";
import { certificationFor, fetchEpisodeCalendar, posterUrl, type RemoteTitle } from "@/features/remote/lib/tmdb";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { remotePublicId } from "@/features/remote/lib/view";
import { Notice } from "@/shared/ui/notice";
import { useColors } from "@/shared/theme";
import { Calendar, ChevronRight, Film } from "@/shared/ui/icons";
import { PosterImage } from "@/shared/ui/poster-image";
import { SkeletonBlock } from "@/shared/ui/skeleton";
import { Tappable } from "@/shared/ui/tappable";

type Show = { name: string; localId?: string; remote?: RemoteTitle; poster?: { uri: string } };

/** "Today", "Tomorrow", or the weekday, plus the calendar date beneath. */
function dayLabel(date: string) {
  const day = new Date(`${date}T12:00:00`);
  const offset = Math.round((day.getTime() - new Date(`${dateKey(0)}T12:00:00`).getTime()) / 86_400_000);
  const name = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday"
    : day.toLocaleDateString(undefined, { weekday: "long" });
  return { name, date: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }), past: offset < 0 };
}

function CalendarSkeleton() {
  return (
    <View className="gap-3 px-5 pt-2">
      {[0, 1, 2].map((section) => (
        <View key={section} className="gap-2.5">
          <SkeletonBlock className="mt-3 h-5 w-32 rounded-md" />
          {[0, 1].map((row) => (
            <View key={row} className="flex-row items-center gap-3 rounded-2xl bg-surface p-3">
              <SkeletonBlock className="h-[66px] w-[44px] rounded-lg" />
              <View className="flex-1 gap-2">
                <SkeletonBlock className="h-4 w-3/5 rounded-md" />
                <SkeletonBlock className="h-3.5 w-2/5 rounded-md" />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function dateKey(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0")).join("-");
}

export function EpisodeCalendarScreen() {
  const { api, preferences } = useClient();
  const { saved, ready } = useRemote();
  const { isHidden } = useHiddenTitles();
  const navigation = useRemoteNavigation();
  const router = useRouter();
  const colors = useColors();
  const from = dateKey(-7);
  const to = dateKey(90);
  const calendar = useResource(async (signal) => {
    if (!ready || preferences.source !== "remote") return { sections: [], failures: 0 };
    const shows = new Map<number, Show>();
    for (const { title } of saved) {
      if (title.mediaType !== "tv" || isHidden(remotePublicId("tv", title.tmdbId))) continue;
      if (!familyAllows(certificationFor(title, preferences.familyRegion), preferences.familyLevel, preferences.familyBlockUnrated)) continue;
      const poster = posterUrl(title.poster, "w185");
      shows.set(title.tmdbId, { name: title.title, remote: title, poster: poster ? { uri: poster } : undefined });
    }
    const home = await api.home(signal);
    for (const item of home.rows.find((row) => row.key === "titles")?.items ?? []) {
      if (item.kind !== "series" || !item.tmdbId || isHidden(item.publicId)) continue;
      if (item.watchlist || shows.has(item.tmdbId)) {
        shows.set(item.tmdbId, {
          name: item.name,
          localId: item.publicId,
          poster: api.image(item.poster) ?? shows.get(item.tmdbId)?.poster,
        });
      }
    }
    const queue = [...shows];
    type Entry = { id: string; title: string; season: number; number: number; show: (typeof queue)[number][1] };
    const dates = new Map<string, Entry[]>();
    let failures = 0;
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && !signal.aborted) {
        const [tmdbId, show] = queue.shift()!;
        try {
          for (const episode of await fetchEpisodeCalendar(tmdbId, from, to, signal)) {
            if (!episode.airDate) continue;
            const data = dates.get(episode.airDate) ?? [];
            data.push({ ...episode, id: `${tmdbId}:${episode.season}:${episode.number}`, show });
            dates.set(episode.airDate, data);
          }
        } catch {
          failures++;
        }
      }
    }));
    return {
      failures,
      sections: [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, data]) => ({
        date,
        data: data.sort((a, b) => a.show.name.localeCompare(b.show.name) || a.number - b.number),
      })),
    };
  }, [api, ready, saved, isHidden, from, to, preferences.source, preferences.familyLevel, preferences.familyRegion, preferences.familyBlockUnrated]);

  const sections = calendar.value?.sections ?? [];
  const failed = calendar.error ?? (calendar.value?.failures ? "Some air dates couldn’t be loaded." : null);
  return (
    <Screen title="Episode calendar" subtitle="New episodes from your saved shows">
      {calendar.loading || !ready ? <CalendarSkeleton /> : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingBottom: 32 }}
          ListHeaderComponent={failed ? <View className="pb-2"><Notice message={failed} retry={calendar.retry} /></View> : null}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center gap-3 px-6 pb-16">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-surface">
                <Calendar size={28} color={colors.brandLight} />
              </View>
              <Text className="text-center font-archivo-bold text-[22px] leading-[28px] text-foreground">
                Nothing scheduled
              </Text>
              <Text className="max-w-[300px] text-center font-archivo-regular text-[14px] leading-[21px] text-muted">
                Save TV shows to your library and their upcoming episodes will show up here.
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => {
            const label = dayLabel(section.date);
            return (
              <View className="flex-row items-baseline gap-2 pb-2.5 pt-5">
                <Text className={label.past ? "font-archivo-bold text-[17px] text-muted" : "font-archivo-bold text-[17px] text-foreground"}>
                  {label.name}
                </Text>
                <Text className="font-archivo-medium text-[13px] text-muted">{label.date}</Text>
              </View>
            );
          }}
          renderItem={({ item, section }) => (
            <Tappable
              feedback="highlight"
              accessibilityRole="button"
              accessibilityLabel={`${item.show.name}, season ${item.season} episode ${item.number}, ${item.title}`}
              className={dayLabel(section.date).past ? "mb-2 flex-row items-center gap-3 rounded-2xl bg-surface p-3 opacity-70" : "mb-2 flex-row items-center gap-3 rounded-2xl bg-surface p-3"}
              onPress={() => {
                if (item.show.localId) router.push({ pathname: "/item/[id]", params: { id: item.show.localId } });
                else if (item.show.remote) navigation.open(item.show.remote);
              }}
            >
              {item.show.poster ? (
                <PosterImage source={item.show.poster} style={{ width: 44, height: 66, borderRadius: 8 }} />
              ) : (
                <View className="h-[66px] w-[44px] items-center justify-center rounded-lg bg-surface-secondary">
                  <Film size={18} color={colors.quiet} />
                </View>
              )}
              <View className="flex-1 gap-1">
                <Text numberOfLines={1} className="font-archivo-bold text-[15px] text-foreground">{item.show.name}</Text>
                <View className="flex-row items-center gap-2">
                  <View className="rounded-md bg-surface-secondary px-1.5 py-0.5">
                    <Text className="font-archivo-bold text-[11px] text-muted">S{item.season} · E{item.number}</Text>
                  </View>
                  <Text numberOfLines={1} className="shrink font-archivo-regular text-[13px] text-muted">{item.title}</Text>
                </View>
              </View>
              <ChevronRight size={18} color={colors.muted} strokeWidth={2} />
            </Tappable>
          )}
        />
      )}
    </Screen>
  );
}
