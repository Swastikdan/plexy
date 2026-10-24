/// Home (PRD 10.2): featured hero banner + horizontally scrolling rows.
import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Info, Video, Plus } from "lucide-react";
import { queries } from "../queries";
import { api, probeBrowserCaps, type ItemCard } from "../client";
import { Row } from "../components/row";
import { Button } from "../components/ui/button";
import { TrailerModal } from "../components/trailer-modal";

const BROWSER_CAPS = typeof document === "undefined" ? "" : JSON.stringify(probeBrowserCaps());

export default function HomeRoute() {
  const navigate = useNavigate();
  const status = useQuery(queries.serverStatus());
  const { data, isLoading, isError } = useQuery(queries.home());

  useEffect(() => {
    if (status.data && !status.data.setupComplete) {
      void navigate({ to: "/setup", replace: true });
    }
  }, [status.data, navigate]);

  if (status.isLoading || (status.data && !status.data.setupComplete) || isLoading) {
    return <SkeletonHome />;
  }
  if (isError) {
    return (
      <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 pt-12 sm:px-8">
        <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
          <h2 className="font-display text-xl font-bold text-ink">Home failed to load</h2>
          <p className="text-sm text-ink-muted">The server didn't answer. Is Plexy running?</p>
          <Link to="/setup">
            <Button variant="brand" className="mt-4">
              Server Setup
            </Button>
          </Link>
        </div>
      </main>
    );
  }
  if (!data) return null;

  const empty = !data.featured && data.rows.length === 0;

  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
      {empty ? (
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface border border-line text-brand-text">
            <Plus size={32} />
          </div>
          <h2 className="font-display text-2xl font-bold text-ink">Your library is ready</h2>
          <p className="text-sm text-ink-muted leading-relaxed">
            Add a movie or TV folder and Plexy will organize your media with posters, metadata, and watch progress.
          </p>
          <Link to="/admin">
            <Button variant="brand" className="mt-2 h-11 px-6 text-sm font-bold">
              Add a Library
            </Button>
          </Link>
        </div>
      ) : (
        <div className="staggered">
          {data.featured && <Hero item={data.featured} />}
          <div className="mt-6 space-y-6">
            {data.rows.map((row) => (
              <Row
                key={row.key}
                title={row.title}
                items={row.items}
                directPlay={row.key === "continue" || row.key === "next"}
                wide={row.key === "continue" || row.key === "next"}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({ component: HomeRoute });

export function State({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <p className="text-sm text-ink-muted leading-relaxed">{body}</p>
      {action}
    </div>
  );
}

function SkeletonHome() {
  return (
    <main className="mx-auto min-h-dvh max-w-[1500px] px-4 pb-24 sm:px-8">
      <div className="mt-2 aspect-[4/5] max-h-[580px] w-full animate-pulse rounded-[var(--radius-hero)] bg-surface sm:aspect-[21/9] sm:max-h-[600px]" />
      <div className="mt-8 space-y-8">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-5 w-48 animate-pulse rounded bg-surface-hover" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 6 }, (_, j) => (
                <div
                  key={j}
                  className="aspect-[2/3] h-52 shrink-0 animate-pulse rounded-[var(--radius-poster)] bg-surface"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

/**
 * Featured hero banner (PRD 10.2).
 */
function Hero({ item }: { item: ItemCard }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [trailerOpen, setTrailerOpen] = useState(false);
  const titleQuery = useQuery(queries.title(item.id));
  const trailer = titleQuery.data?.trailer ?? null;
  const knownFileId = titleQuery.data?.file?.fileId ?? null;

  const prefetch = () => {
    if (knownFileId && BROWSER_CAPS) {
      void queryClient.prefetchQuery(queries.play(knownFileId, BROWSER_CAPS));
    }
  };

  const handlePlay = async () => {
    let fileId = knownFileId;
    if (!fileId) {
      try {
        const detail = await api.title(item.id);
        fileId = detail.file?.fileId ?? null;
      } catch {
        /* fall through to the detail page */
      }
    }
    if (fileId) {
      navigate({ to: "/watch/$fileId", params: { fileId: String(fileId) } });
    } else {
      navigate({ to: "/title/$itemId", params: { itemId: String(item.id) } });
    }
  };

  return (
    <section className="relative mt-2 overflow-hidden rounded-[var(--radius-hero)] border border-line/60 bg-surface">
      <div className="relative aspect-[4/5] max-h-[580px] w-full sm:aspect-[21/9] sm:max-h-[600px]">
        <img
          src={item.backdrop ?? item.poster ?? ""}
          alt=""
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="h-full w-full object-cover object-top"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        {/* Holster the artwork into the canvas with directional masks */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-transparent"
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/60 to-transparent"
          aria-hidden
        />
      </div>

      <div className="absolute bottom-0 left-0 max-w-2xl p-6 sm:p-12">
        <h1 className="font-display text-3xl font-black leading-tight text-ink sm:text-5xl">
          {item.name}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs sm:text-sm text-ink-muted">
          {item.year && <span className="font-medium text-ink">{item.year}</span>}
          {item.runtime && <span>{item.runtime} min</span>}
          {item.rating && (
            <span className="flex items-center gap-1 font-semibold text-amber">
              ★ {item.rating.toFixed(1)}
            </span>
          )}
          {item.genres?.slice(0, 3).map((g) => (
            <span
              key={g}
              className="rounded-none bg-canvas/70 px-2.5 py-0.5 text-xs text-ink"
            >
              {g}
            </span>
          ))}
        </div>

        {item.overview && (
          <p className="mt-3 line-clamp-3 max-w-[60ch] text-sm leading-relaxed text-ink-muted sm:text-base">
            {item.overview}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={handlePlay}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            className="h-11 px-6 text-sm font-bold"
          >
            <Play size={18} fill="currentColor" />
            Play
          </Button>

          <Link to="/title/$itemId" params={{ itemId: String(item.id) }}>
            <Button variant="secondary" className="h-11 px-4 text-sm font-semibold">
              <Info size={18} />
              More Info
            </Button>
          </Link>

          {trailer && (
            <Button
              variant="secondary"
              onClick={() => setTrailerOpen(true)}
              className="h-11 px-4 text-sm font-semibold"
            >
              <Video size={18} />
              Trailer
            </Button>
          )}
        </div>
      </div>

      <TrailerModal
        open={trailerOpen}
        onOpenChange={setTrailerOpen}
        trailerKey={trailer?.key ?? null}
        title={item.name}
      />
    </section>
  );
}
