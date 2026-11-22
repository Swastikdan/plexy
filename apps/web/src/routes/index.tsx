import { getSignedInUser } from "@/auth";
/// Home: one featured carousel, then the shelves that matter.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpDown, FolderPlus, Plus } from "lucide-react";
import { queries } from "@/queries";
import { Row } from "@/components/row";
import { HomeHero } from "@/components/home-hero";
import { Button, Dropdown } from "@heroui/react";
import { Page } from "@/components/page";
import { State } from "@/components/state";
import type { ItemCard } from "@/client";

const ROW_META: Record<
  string,
  { viewAll?: "movies" | "tv"; list?: "watchlist" | "favorites" }
> = {
  "recent-movies": { viewAll: "movies" },
  "recent-shows": { viewAll: "tv" },
  watchlist: { list: "watchlist" },
  favorites: { list: "favorites" },
};

function HomeSkeleton() {
  return (
    <Page className="pt-4 sm:pt-5">
      <div className="space-y-9">
        <div className="skeleton h-[clamp(28rem,62vh,44rem)] rounded-[calc(var(--radius)*3)]" />
        {[0, 1].map((row) => (
          <div key={row} className="space-y-4">
            <div className="skeleton h-5 w-44 rounded-md" />
            <div className="flex gap-3.5 overflow-hidden">
              {[0, 1, 2, 3, 4, 5, 6].map((card) => (
                <div key={card} className="skeleton aspect-[2/3] h-[13rem] shrink-0 rounded-[calc(var(--radius)*1.35)]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

function HomeRoute() {
  const navigate = useNavigate();
  const [continueSort, setContinueSort] = useState<"recent" | "title">("recent");
  const status = useQuery({
    ...queries.serverStatus(),
    select: (data) => ({
      setupComplete: data.setupComplete,
      adminAvailable: data.adminAvailable,
    }),
  });
  const { data, isLoading, isError } = useQuery(queries.home());

  // The server's featured title leads the carousel; the recently-added rows
  // fill the remaining slides. Episodes, continue-watching and the watchlist
  // stay in their own rows: including watchlist/favorites here would reorder
  // the carousel whenever someone toggles a flag, which looks like the hero
  // jumping to a different title. A title only appears once.
  const featuredItems = useMemo(() => {
    if (!data) return [] as ItemCard[];
    const list: ItemCard[] = [];
    const seen = new Set<string>();
    const add = (item: ItemCard) => {
      if (item.kind !== "movie" && item.kind !== "series") return;
      if (seen.has(item.publicId)) return;
      seen.add(item.publicId);
      list.push(item);
    };
    if (data.featured) add(data.featured);
    for (const row of data.rows) {
      if (row.key !== "recent-movies" && row.key !== "recent-shows") continue;
      for (const item of row.items) {
        add(item);
        if (list.length >= 6) break;
      }
      if (list.length >= 6) break;
    }
    return list;
  }, [data]);

  useEffect(() => {
    if (status.data && !status.data.setupComplete && status.data.adminAvailable) {
      void navigate({ to: "/setup", replace: true });
    }
  }, [status.data, navigate]);

  if (status.isLoading || (status.data && !status.data.setupComplete && status.data.adminAvailable) || isLoading) {
    return <HomeSkeleton />;
  }
  if (isError) {
    return (
      <Page>
        <State
          icon={FolderPlus}
          title="Home failed to load"
          body="The server didn't answer. Is Plexy running?"
          action={
            <Link to="/connect">
              <Button>
                Choose a server
              </Button>
            </Link>
          }
        />
      </Page>
    );
  }
  if (!data) return null;

  const rows = data.rows;
  const empty = rows.length === 0 && !data.featured;
  const administrator = getSignedInUser()?.role === "admin";

  return (
    <Page className="!pt-0">
      {empty ? (
        <div className="mx-auto flex min-h-[64vh] max-w-lg flex-col items-center justify-center gap-4 text-center">
          <div className="relative mb-1 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface text-muted">
            <Plus size={26} strokeWidth={1.6} aria-hidden />
            <span aria-hidden className="absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full bg-accent" />
          </div>
          <div>
            <h2 className="font-sans text-2xl font-extrabold tracking-[-0.04em] text-foreground">
              {administrator ? "Your library is ready" : "No titles shared yet"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
              {administrator
                ? "Add a movie or TV folder and Plexy will organize your media with posters, metadata, and watch progress."
                : "Your administrator can share libraries, folders, or individual titles with your account."}
            </p>
          </div>
          {administrator && (
            <Link to="/add-library">
              <Button className="mt-1 h-10 px-5 text-sm font-semibold">
                Add a library
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="staggered space-y-3 pb-8 sm:space-y-4">
          {featuredItems.length > 0 && <HomeHero items={featuredItems} />}

          <div className="space-y-8 sm:space-y-9">
            {rows.map((row) => {
              const meta = ROW_META[row.key];
              const items =
                row.key === "continue" && continueSort === "title"
                  ? [...row.items].sort((a, b) => a.name.localeCompare(b.name))
                  : row.items;
              const action =
                row.key === "continue" ? (
                  <Dropdown>
                    <Dropdown.Trigger className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground">
                      <ArrowUpDown size={12} aria-hidden />
                      {continueSort === "title" ? "A–Z" : "Recently watched"}
                    </Dropdown.Trigger>
                    <Dropdown.Popover placement="bottom end">
                      <Dropdown.Menu onAction={(key) => setContinueSort(key as "recent" | "title")}>
                        <Dropdown.Item id="recent" textValue="Recently watched">
                          Recently watched
                        </Dropdown.Item>
                        <Dropdown.Item id="title" textValue="A–Z">
                          A–Z
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                ) : meta?.viewAll ? (
                  <Link
                    to="/library/$kind"
                    params={{ kind: meta.viewAll }}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                  >
                    See all
                    <ArrowRight
                      size={12}
                      className="transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                ) : meta?.list ? (
                  <Link
                    to="/list/$kind"
                    params={{ kind: meta.list }}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
                  >
                    See all
                    <ArrowRight
                      size={12}
                      className="transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                ) : undefined;
              return (
                <Row
                  key={row.key}
                  id={row.key === "continue" ? "continue-watching" : undefined}
                  title={row.title}
                  items={items}
                  directPlay={row.key === "continue" || row.key === "next"}
                  wide={row.key === "continue" || row.key === "next"}
                  action={action}
                />
              );
            })}
          </div>
        </div>
      )}
    </Page>
  );
}

export const Route = createFileRoute("/")({ component: HomeRoute });
