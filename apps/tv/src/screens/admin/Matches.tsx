import React, { useState } from "react";
import { View } from "react-native";
import type {
  ReviewEntry,
  ReviewPayload,
  TmdbMatchResult,
  TmdbMatchSearchResponse,
} from "../../../../../packages/api-client/src/types";
import { useClient } from "../../../../../packages/native-client/src/context";
import { useResource } from "../../../../../packages/native-client/src/hooks";
import { Button, Field, Heading, Label } from "../../components/ui";
import {
  confirmAction,
  Feedback,
  Group,
  Refresh,
  ResourceState,
  useAdminAction,
} from "./shared";

type Preview = TmdbMatchResult & {
  runtime: number | null;
  rating: number | null;
};
export function AdminMatches() {
  const { api } = useClient();
  const [filter, setFilter] = useState("attention");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const resource = useResource(
    (signal) =>
      api.request<ReviewPayload>(
        `/api/matches/review?status=${filter}&q=${encodeURIComponent(query)}&limit=200`,
        { signal },
      ),
    [api, filter, query],
  );
  const [selected, setSelected] = useState<ReviewEntry | null>(null);
  const [filename, setFilename] = useState("");
  const [fileType, setFileType] = useState<"movies" | "tv">("movies");
  const [parsed, setParsed] = useState<{
    title: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    episodeEnd: number | null;
    explicitId: number | null;
    isSpecial: boolean;
  } | null>(null);
  const action = useAdminAction();
  return (
    <View style={{ gap: 12 }}>
      <Heading>Fix library matches</Heading>
      <Refresh onPress={resource.retry} />
      {["attention", "all", "matched", "review", "unmatched"].map((value) => (
        <Button
          key={value}
          label={
            value === "attention"
              ? "Needs attention"
              : value === "all"
                ? "All titles"
                : value === "matched"
                  ? "Matched"
                  : value === "review"
                    ? "Review"
                    : "Unmatched"
          }
          selected={filter === value}
          onPress={() => {
            setFilter(value);
            setSelected(null);
          }}
        />
      ))}
      <Field
        label="Find a title or file"
        value={search}
        onChangeText={setSearch}
      />
      <Button
        label="Search library matches"
        onPress={() => {
          setQuery(search.trim());
          setSelected(null);
          resource.retry();
        }}
      />
      <ResourceState
        resource={resource}
        empty={
          resource.value?.items.length === 0
            ? "No titles match this filter."
            : undefined
        }
      />
      {resource.value && (
        <Label>
          {resource.value.counts.attention} need attention ·{" "}
          {resource.value.counts.all} total. Showing up to 200 results; narrow
          the search to find more.
        </Label>
      )}
      {resource.value?.items.map((item) => (
        <Button
          key={item.id}
          label={`${item.name}${item.year ? ` (${item.year})` : ""} · ${item.matchStatus}`}
          selected={selected?.id === item.id}
          onPress={() =>
            setSelected((previous) => (previous?.id === item.id ? null : item))
          }
        />
      ))}
      {selected && (
        <MatchEditor
          key={selected.id}
          entry={selected}
          changed={() => {
            setSelected(null);
            resource.retry();
          }}
        />
      )}
      <Group title="Test a file name">
        <Field
          label="File name or server path"
          value={filename}
          onChangeText={setFilename}
          autoCapitalize="none"
        />
        <Button
          label="Movie file"
          selected={fileType === "movies"}
          onPress={() => setFileType("movies")}
        />
        <Button
          label="TV episode file"
          selected={fileType === "tv"}
          onPress={() => setFileType("tv")}
        />
        <Button
          label="Parse file name"
          disabled={action.busy || !filename.trim()}
          onPress={async () => {
            setParsed(null);
            const result = await action.run<{
              parsed: NonNullable<typeof parsed>;
            }>(
              "/api/match/test-name",
              "POST",
              { name: filename.trim(), type: fileType },
              "File name parsed. No library records changed.",
            );
            if (result) setParsed(result.parsed);
          }}
        />
        <Feedback action={action} />
        {parsed && (
          <>
            <Label>Title: {parsed.title}</Label>
            <Label>
              Year: {parsed.year ?? "Unknown"} · Season:{" "}
              {parsed.season ?? "None"} · Episode: {parsed.episode ?? "None"}
              {parsed.episodeEnd ? `–${parsed.episodeEnd}` : ""}
            </Label>
            <Label>
              Metadata ID: {parsed.explicitId ?? "None"} · Special:{" "}
              {parsed.isSpecial ? "Yes" : "No"}
            </Label>
          </>
        )}
      </Group>
    </View>
  );
}
function MatchEditor({
  entry,
  changed,
}: {
  entry: ReviewEntry;
  changed: () => void;
}) {
  const { api } = useClient();
  const [search, setSearch] = useState(entry.name);
  const [year, setYear] = useState(entry.year ? String(entry.year) : "");
  const [results, setResults] = useState<TmdbMatchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [candidate, setCandidate] = useState<{
    tmdbId: number;
    type: string;
  } | null>(null);
  const type = entry.kind === "movie" ? "movie" : "tv";
  const preview = useResource(
    (signal) =>
      candidate
        ? api.request<Preview>(
            `/api/match/preview/${candidate.type}/${candidate.tmdbId}`,
            { signal },
          )
        : Promise.resolve(null),
    [api, candidate?.tmdbId, candidate?.type],
  );
  const action = useAdminAction();
  return (
    <Group title={entry.name}>
      {entry.originalName && (
        <Label muted>Original: {entry.originalName}</Label>
      )}
      {entry.reason && <Label muted>{entry.reason}</Label>}
      <Feedback action={action} />
      <Field
        label="Search metadata provider"
        value={search}
        onChangeText={setSearch}
      />
      <Field
        label="Release year (optional)"
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
      />
      <Button
        label="Search metadata"
        disabled={action.busy || !search.trim()}
        onPress={async () => {
          const parsedYear = year.trim() ? Number(year) : undefined;
          if (
            parsedYear !== undefined &&
            (!Number.isInteger(parsedYear) ||
              parsedYear < 1800 ||
              parsedYear > 3000)
          ) {
            action.setMessage("Enter a valid release year, or leave it blank.");
            return;
          }
          const result = await action.run<TmdbMatchSearchResponse>(
            "/api/match/search",
            "POST",
            {
              type,
              query: search.trim(),
              ...(parsedYear === undefined ? {} : { year: parsedYear }),
            },
            "Metadata search complete.",
          );
          if (result) {
            setResults(result.results);
            setSearched(true);
          }
        }}
      />
      {searched && !results.length && (
        <Label muted>
          No metadata matches found. Try another title or year.
        </Label>
      )}
      {results.map((result) => (
        <Button
          key={result.tmdbId}
          label={`Preview ${result.title}${result.year ? ` (${result.year})` : ""}`}
          selected={candidate?.tmdbId === result.tmdbId}
          onPress={() => setCandidate(result)}
        />
      ))}
      {!searched &&
        entry.candidates.map((result) => (
          <Button
            key={result.tmdbId}
            label={`Preview ${result.title}${result.year ? ` (${result.year})` : ""}`}
            selected={candidate?.tmdbId === result.tmdbId}
            onPress={() =>
              setCandidate({ tmdbId: result.tmdbId, type: result.tmdbType })
            }
          />
        ))}
      {candidate && <ResourceState resource={preview} />}
      {preview.value && (
        <>
          <Label>
            {preview.value.title} {preview.value.year ?? ""}
          </Label>
          {preview.value.overview && (
            <Label muted>{preview.value.overview}</Label>
          )}
          <Label>
            Runtime: {preview.value.runtime ?? "Unknown"} min · Rating:{" "}
            {preview.value.rating ?? "Unknown"}
          </Label>
          <Button
            label="Apply this match"
            disabled={action.busy}
            onPress={() =>
              confirmAction(
                "Replace library match?",
                `Match ${entry.name} to ${preview.value!.title}? Manual matches stay locked during rescans.`,
                () => {
                  void action
                    .run(
                      `/api/items/${entry.id}/match`,
                      "POST",
                      { type, tmdbId: preview.value!.tmdbId },
                      "Match applied.",
                    )
                    .then((result) => {
                      if (result) changed();
                    });
                },
              )
            }
          />
        </>
      )}
      <Button
        label="Remove title from library"
        disabled={action.busy}
        onPress={() =>
          confirmAction(
            "Remove this title?",
            "This removes the indexed title, its descendants, watch history and prepared copies. Original video files stay on the server; a rescan can add the title again.",
            () => {
              void action
                .run(
                  `/api/items/${entry.id}`,
                  "DELETE",
                  undefined,
                  "Title removed.",
                )
                .then((result) => {
                  if (result) changed();
                });
            },
          )
        }
      />
      <Button
        label="Refresh saved metadata"
        disabled={action.busy || !entry.tmdbId}
        onPress={() => {
          void action
            .run(
              `/api/items/${entry.id}/refresh`,
              "POST",
              undefined,
              "Metadata refreshed.",
            )
            .then((result) => {
              if (result) changed();
            });
        }}
      />
    </Group>
  );
}
