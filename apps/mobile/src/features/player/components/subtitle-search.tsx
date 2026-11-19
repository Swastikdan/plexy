import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import type { Playability } from "@/core/library/catalog-api";
import { useResource } from "@/core/resources/use-resource";
import { findLanguageTrack, mediaLanguageName } from "@/shared/lib/media-language";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { Spinner } from "@/shared/ui/spinner";
import { downloadSubtitle, searchSubtitles, type SubtitleResult } from "../lib/subtitle-search";

export function SubtitleSearch({ file, language, close, save }: {
  file: Playability;
  language: string;
  close: () => void;
  save: (result: SubtitleResult, text: string) => Promise<void>;
}) {
  const lookup = useResource((signal) => searchSubtitles(file, signal), [file.fileId, file.tmdbId, file.seasonNumber, file.episodeNumber]);
  const [allLanguages, setAllLanguages] = useState(!language);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const matches = (lookup.value ?? []).filter((result) => allLanguages || findLanguageTrack([result], language));
  async function select(result: SubtitleResult) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setDownloading(true);
    setError("");
    try {
      const text = await downloadSubtitle(result, controller.signal);
      if (!controller.signal.aborted) await save(result, text);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Subtitle download failed.");
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }
  return (
    <Modal visible transparent onRequestClose={close} supportedOrientations={["landscape"]}>
      <View className="flex-1 items-center justify-center bg-black/65 p-4">
        <View accessibilityViewIsModal className="w-full max-w-[540px] max-h-full rounded-2xl bg-overlay p-4">
          <View className="flex-row items-center justify-between gap-3">
            <Text accessibilityRole="header" className="font-archivo-bold text-lg text-foreground">Find subtitles</Text>
            <Button label="Close" onPress={close} />
          </View>
          {language ? <Button
            label={allLanguages ? `Show ${mediaLanguageName(language) ?? language} only` : "Show all languages"}
            onPress={() => setAllLanguages(!allLanguages)}
          /> : null}
          {lookup.loading ? <Spinner accessibilityLabel="Searching OpenSubtitles" /> : null}
          {lookup.error ? <Notice message={lookup.error} retry={lookup.retry} /> : null}
          {error ? <Notice message={error} /> : null}
          {downloading ? <Spinner accessibilityLabel="Downloading subtitle" /> : null}
          <FlatList
            data={matches}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={!lookup.loading && !lookup.error ? <Text className="py-3 text-muted">No matching subtitles.</Text> : null}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" disabled={downloading} onPress={() => void select(item)} className="border-b border-border px-2 py-3">
                <Text className="text-foreground" numberOfLines={2}>{item.name}</Text>
                <Text className="text-muted">{mediaLanguageName(item.language) ?? item.language} · OpenSubtitles</Text>
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}
