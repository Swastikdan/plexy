/// Top navigation — brand and page context on the left, the main shelves next
/// to them, and the action cluster on the right.
///
/// The left context keeps one width on desktop so changing from the brand to a
/// back button + page title never shifts the shelves. Search is an icon here;
/// the search screen owns the field. On the home route the bar floats over the
/// hero and switches to the theme surface after the first scroll.
import { useEffect, useState } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, Library, Search, Server, FolderHeart, Clock3 } from "lucide-react";
import { queries } from "@/queries";
import { cx } from "@/lib/cx";
import { useIsFullscreen } from "@/lib/use-fullscreen";
import { isElectronMac } from "@/lib/platform";
import { accountRequest, getSignedInUser, type AccountUser } from "@/auth";
import { BackButton } from "./back-button";
import { UserAvatar } from "./user-avatar";

function resolvePageTitle(
  pathname: string,
  titleDataName?: string | null,
  libraries?: { id: number; name: string; type: string }[] | null,
): string {
  if (pathname.startsWith("/title/")) {
    return titleDataName || "";
  }
  if (pathname === "/library/movies") return "Movies";
  if (pathname === "/library/tv" || pathname === "/library/series") return "TV shows";
  if (pathname === "/library/all") return "Library";
  if (pathname.startsWith("/library/")) {
    const rawKind = pathname.replace("/library/", "");
    const matchingLib = libraries?.find(
      (l) => String(l.id) === rawKind || l.type === rawKind || l.name.toLowerCase() === rawKind.toLowerCase(),
    );
    if (matchingLib) return matchingLib.name;
    return rawKind.charAt(0).toUpperCase() + rawKind.slice(1);
  }
  if (pathname.startsWith("/search")) return "Search";
  if (pathname.startsWith("/collections")) return "Collections";
  if (pathname.startsWith("/list/")) {
    const kind = pathname.replace("/list/", "");
    if (kind === "watchlist") return "Watchlist";
    if (kind === "favorites") return "Favorites";
    if (kind === "hidden") return "Hidden titles";
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
  if (pathname.startsWith("/history")) return "History";
  if (pathname.startsWith("/person/")) return "Cast";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/admin")) return "Settings";
  if (pathname.startsWith("/account")) return "Settings";
  if (pathname.startsWith("/add-library")) return "Add a library";
  if (pathname.startsWith("/setup")) return "Setup";
  if (pathname.startsWith("/connect")) return "Server";
  if (pathname.startsWith("/watch")) return titleDataName || "Now playing";
  return "";
}

const NAV_LINKS = [
  { to: "/" as const, label: "Home", icon: Home, exact: true },
  {
    to: "/library/$kind" as const,
    label: "Library",
    icon: Library,
    params: { kind: "all" as const },
    exact: false,
  },
  { to: "/collections" as const, label: "Collections", icon: FolderHeart, exact: false },
  { to: "/history" as const, label: "History", icon: Clock3, exact: false },
];

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFullscreen = useIsFullscreen();
  const isHome = pathname === "/";
  const overHero = isHome && !scrolled;
  const electronMac = isElectronMac();

  const { data: libraries } = useQuery(queries.libraries());

  const titleMatch = pathname.match(/^\/title\/([^/?#]+)/);
  const titleId = titleMatch ? titleMatch[1] : null;
  const { data: titleData } = useQuery({
    ...queries.title(titleId ?? ""),
    enabled: !!titleId,
  });

  const pageTitle = resolvePageTitle(pathname, titleData?.item?.name, libraries);

  const account = useQuery({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser }>("/me"),
    staleTime: 30_000,
    retry: false,
  });
  const signedIn = account.data?.user ?? getSignedInUser();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      void router.navigate({ to: "/" });
    }
  };

  useEffect(() => {
    if (window.electronAPI?.onNavigate) {
      const unsub = window.electronAPI.onNavigate((to) => {
        router.navigate({ to: to as any });
      });
      return unsub;
    }
  }, [router]);

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · Plexy` : "Plexy · Personal Media";
  }, [pageTitle]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Search is the shortcut people reach for most on a keyboard. The header
  // carries a single icon now; the search screen owns the full field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (pathname.startsWith("/search")) {
        document
          .querySelector<HTMLInputElement>('input[aria-label="Search your films and shows"]')
          ?.focus();
        return;
      }
      void navigate({ to: "/search" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, pathname]);

  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className={cx(
        "sticky top-0 z-40 select-none px-3 sm:px-5 lg:px-8",
        "transition-[background-color,border-color,box-shadow] duration-300 ease-out",
        scrolled
          ? "border-b border-border bg-background/88 shadow-[0_10px_30px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          : isHome
            ? "border-b border-transparent bg-transparent"
            : "border-b border-transparent bg-background/40 backdrop-blur-[2px]",
      )}
    >
      {/* Brand and page context stay left; the shelves follow, and the action
          cluster stays right. */}
      <div
        className={cx(
          "relative mx-auto flex h-[3.25rem] max-w-[var(--app-max)] items-center gap-2 sm:gap-3 md:h-[var(--app-topbar-height)]",
          electronMac && !isFullscreen && "pl-[4.9rem]",
        )}
      >
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className={cx(
            "flex min-w-0 items-center gap-2 lg:w-[10.5rem] lg:shrink-0",
            electronMac && "md:w-[10.5rem] md:shrink-0",
          )}
        >
          {isHome ? (
            <Link
              to="/"
              aria-label="Plexy home"
              className="group flex min-w-0 items-center gap-2.5 rounded-lg p-1 transition-transform active:scale-95"
            >
              <img src="/icon.svg" alt="" className="h-6 w-6 shrink-0" />
              <span
                className={cx(
                  "font-sans text-[15px] font-extrabold tracking-[-0.03em]",
                  overHero ? "text-white" : "text-foreground",
                )}
              >
                Plexy
              </span>
            </Link>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <BackButton onClick={handleBack} label="Back to previous page" />
              <span
                title={pageTitle}
                className="truncate font-sans text-sm font-bold tracking-[-0.02em] text-foreground sm:text-[15px]"
              >
                {pageTitle || "Plexy"}
              </span>
            </div>
          )}
        </div>

        <nav
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className={cx("topnav-tabs hidden shrink-0 items-center gap-0.5 lg:flex", electronMac && "md:flex")}
          aria-label="Main navigation"
        >
          {NAV_LINKS.map((link) => {
            const active = link.exact
              ? pathname === link.to
              : link.to === "/library/$kind"
                ? pathname.startsWith("/library")
                : pathname.startsWith(link.to);
            return (
              <Link
                key={link.label}
                to={link.to}
                params={"params" in link ? link.params : undefined}
                aria-current={active ? "page" : undefined}
                aria-label={link.label}
                title={link.label}
                data-selected={active ? "" : undefined}
                className={cx(
                  "topnav-tab inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
                  overHero
                    ? active
                      ? "bg-white/12 text-white"
                      : "text-white/62 hover:bg-white/10 hover:text-white"
                    : active
                      ? "bg-surface-secondary text-foreground"
                      : "text-muted hover:bg-surface-secondary hover:text-foreground",
                )}
              >
                <link.icon size={14} strokeWidth={1.9} className="shrink-0" aria-hidden />
                <span className="topnav-tab-label" aria-hidden="true">
                  <span className="overflow-hidden">
                    <span className="block pl-1.5">{link.label}</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="ml-auto flex shrink-0 items-center justify-end gap-0.5 sm:gap-1"
        >
          {!window.electronAPI?.localOnly && (
            <Link
              to="/connect"
              aria-label="Server connection"
              aria-current={pathname.startsWith("/connect") ? "page" : undefined}
              title="Server connection"
              className={cx("cinema-action", !overHero && "cinema-action--surface")}
            >
              <Server size={16} strokeWidth={1.9} />
            </Link>
          )}

          <Link
            to="/search"
            aria-label="Search"
            title="Search (⌘K)"
            aria-keyshortcuts="Meta+K"
            aria-current={pathname.startsWith("/search") ? "page" : undefined}
            className={cx("cinema-action", !overHero && "cinema-action--surface")}
          >
            <Search size={17} strokeWidth={1.9} />
          </Link>

          <Link
            to="/settings"
            search={{ tab: "account" }}
            aria-label="Profile and settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            title="Profile and settings"
            className="group ml-0.5 inline-flex h-9 items-center justify-center rounded-full p-0.5 transition-transform duration-150 active:scale-95 aria-[current=page]:ring-2 aria-[current=page]:ring-[var(--brand)] aria-[current=page]:ring-offset-2 aria-[current=page]:ring-offset-background"
          >
            <UserAvatar
              user={signedIn}
              size={27}
              alt=""
              className="transition-[border-color,background-color] duration-150 group-hover:border-foreground/25 group-hover:bg-surface-tertiary"
            />
          </Link>
        </div>
      </div>
    </header>
  );
}
