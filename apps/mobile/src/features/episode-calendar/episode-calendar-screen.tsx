import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Pressable, SectionList, Text } from "react-native";
import { useClient } from "@/core/client/client-provider";
import { familyAllows } from "@/core/content/audience";
import { useHiddenTitles } from "@/core/content/hidden-titles";
import { useResource } from "@/core/resources/use-resource";
import { useRemote } from "@/features/remote/remote-provider";
import { certificationFor, fetchEpisodeCalendar, type RemoteTitle } from "@/features/remote/lib/tmdb";
import { useRemoteNavigation } from "@/features/remote/lib/use-remote-navigation";
import { remotePublicId } from "@/features/remote/lib/view";
import { Notice } from "@/shared/ui/notice";
import { PageHeader } from "@/shared/ui/page-header";
import { Spinner } from "@/shared/ui/spinner";

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
  const from = dateKey(-7);
  const to = dateKey(90);
  const calendar = useResource(async (signal) => {
    if (!ready || preferences.source !== "remote") return { sections: [], failures: 0 };
    const shows = new Map<number, { name: string; localId?: string; remote?: RemoteTitle }>();
    for (const { title } of saved) {
      if (title.mediaType !== "tv" || isHidden(remotePublicId("tv", title.tmdbId))) continue;
      if (!familyAllows(certificationFor(title, preferences.familyRegion), preferences.familyLevel, preferences.familyBlockUnrated)) continue;
      shows.set(title.tmdbId, { name: title.title, remote: title });
    }
    const home = await api.home(signal);
    for (const item of home.rows.find((row) => row.key === "titles")?.items ?? []) {
      if (item.kind !== "series" || !item.tmdbId || isHidden(item.publicId)) continue;
      if (item.watchlist || shows.has(item.tmdbId)) {
        shows.set(item.tmdbId, { name: item.name, localId: item.publicId });
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

  return (
    <SafeAreaView className="flex-1 bg-background">
      <PageHeader title="Episode calendar" />
      {calendar.loading || !ready ? <Spinner /> : (
        <SectionList
          sections={calendar.value?.sections ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20, gap: 8 }}
          ListHeaderComponent={<Notice message={
            calendar.error ?? (calendar.value?.failures
              ? "Some air dates couldn’t be loaded. Tap to retry."
              : "Air dates are shown for saved shows. Playback availability varies.")
          } retry={calendar.error || calendar.value?.failures ? calendar.retry : undefined} />}
          ListEmptyComponent={<Text className="text-muted">No scheduled episodes found. Save TV shows to your library to see their air dates here.</Text>}
          renderSectionHeader={({ section }) => (
            <Text className="bg-background py-2 font-archivo-bold text-foreground">
              {new Date(`${section.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              className="rounded-xl bg-surface px-4 py-3"
              onPress={() => {
                if (item.show.localId) router.push({ pathname: "/item/[id]", params: { id: item.show.localId } });
                else if (item.show.remote) navigation.open(item.show.remote);
              }}
            >
              <Text className="font-archivo-bold text-foreground">{item.show.name}</Text>
              <Text className="text-muted">S{item.season} E{item.number} · {item.title}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
