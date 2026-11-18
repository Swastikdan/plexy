/// Top navigation — brand and page context on the left, shelves in the middle,
/// and search + account on the right.
///
/// Three equal tracks keep the middle navigation fixed in place: switching the
/// left slot from the brand to a back button and page title never moves the
/// shelves. Only the top bar's paint changes on scroll, never its geometry.
import { useEffect, useState } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, Library, Search, Server } from "lucide-react";
import { queries } from "../queries";
import { cx } from "../lib/cx";
import { useIsFullscreen } from "../lib/use-fullscreen";
import { isElectronMac } from "../lib/platform";
import { accountRequest, getSignedInUser, type AccountUser } from "../auth";
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
  if (pathname === "/library/tv" || pathname === "/library/series") return "TV Shows";
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
  if (pathname.startsWith("/person/")) return "Cast";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/admin")) return "Settings";
  if (pathname.startsWith("/account")) return "Settings";
  if (pathname.startsWith("/add-library")) return "Add media";
  if (pathname.startsWith("/setup")) return "Setup";
  if (pathname.startsWith("/connect")) return "Server";
  if (pathname.startsWith("/watch")) return titleDataName || "Now Playing";
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
];

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFullscreen = useIsFullscreen();
  const isHome = pathname === "/";
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

  // Search is the shortcut people reach for most on a keyboard. It lives on
  // the header now that the rail is gone.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      void navigate({ to: "/search" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className={cx(
        "sticky top-0 z-40 select-none px-3 sm:px-5 lg:px-8",
        "transition-[background-color,border-color,box-shadow] duration-300 ease-out",
        scrolled
          ? "border-b border-border bg-background/88 shadow-[0_10px_30px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          : "border-b border-transparent bg-background/40 backdrop-blur-[2px]",
      )}
    >
      {/* The centre track is fixed, so the brand → back + title change in the
          left track cannot shift the shelves or the controls. */}
      <div className="mx-auto grid h-[3.25rem] max-w-[var(--app-max)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4 md:h-[var(--app-topbar-height)]">
        <div
          style={{
            WebkitAppRegion: "no-drag",
            paddingLeft: electronMac && !isFullscreen ? "4.9rem" : undefined,
          } as React.CSSProperties}
          className="flex min-w-0 items-center gap-2"
        >
          {isHome ? (
            <Link
              to="/"
              aria-label="Plexy home"
              className="group flex min-w-0 items-center gap-2.5 rounded-lg p-1 transition-transform active:scale-95"
            >
              <img src="/icon.svg" alt="" className="h-6 w-6 shrink-0" />
              <span className="font-sans text-[15px] font-extrabold tracking-[-0.03em] text-foreground">
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
          className="hidden items-center gap-0.5 lg:flex"
          aria-label="Main navigation"
        >
          {NAV_LINKS.map((link) => {
            const active = link.exact ? pathname === link.to : pathname.startsWith("/library");
            return (
              <Link
                key={link.label}
                to={link.to}
                params={"params" in link ? link.params : undefined}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-[background-color,color,transform] duration-150 hover:bg-surface-secondary hover:text-foreground active:scale-[0.97]",
                  active ? "bg-surface-secondary text-foreground" : "text-muted",
                )}
              >
                <link.icon size={14} strokeWidth={1.9} aria-hidden />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center justify-end gap-0.5 sm:gap-1"
        >
          {!window.electronAPI?.localOnly && (
            <Link
              to="/connect"
              aria-label="Server connection"
              title="Server connection"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-[color,background-color,transform] duration-150 hover:bg-surface-secondary hover:text-foreground active:scale-95 [&.active]:text-foreground"
            >
              <Server size={16} strokeWidth={1.9} />
            </Link>
          )}

          <Link
            to="/search"
            aria-label="Search"
            title="Search (⌘K)"
            aria-current={pathname.startsWith("/search") ? "page" : undefined}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-[color,background-color,transform] duration-150 hover:bg-surface-secondary hover:text-foreground active:scale-95 [&.active]:bg-surface-secondary [&.active]:text-foreground"
          >
            <Search size={17} strokeWidth={1.9} />
          </Link>

          <Link
            to="/settings"
            search={{ tab: "overview" }}
            aria-label="Account and settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            title="Account and settings"
            className="group ml-0.5 inline-flex h-9 items-center justify-center rounded-full p-0.5 transition-transform duration-150 active:scale-95 [&.active]:ring-2 [&.active]:ring-accent/45 [&.active]:ring-offset-2 [&.active]:ring-offset-background"
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
