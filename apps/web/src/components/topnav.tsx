import { getClientRuntime } from "../runtime-config";
/// Top navigation — sticky header that transitions to a solid blur on scroll,
/// with an intelligent responsive layout for desktop & mobile,
/// zero-title library filtering, and interactive feedback.
import { useEffect, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Settings, Film, Tv, Home, Server, UserRound } from "lucide-react";
import { queries } from "../queries";
import { cx } from "./poster";
import { useIsFullscreen } from "../lib/use-fullscreen";
import { isElectronMac } from "../lib/platform";
import { BackButton } from "./back-button";

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
  if (pathname.startsWith("/library/")) {
    const rawKind = pathname.replace("/library/", "");
    const matchingLib = libraries?.find(
      (l) => String(l.id) === rawKind || l.type === rawKind || l.name.toLowerCase() === rawKind.toLowerCase(),
    );
    if (matchingLib) return matchingLib.name;
    return rawKind.charAt(0).toUpperCase() + rawKind.slice(1);
  }
  if (pathname.startsWith("/search")) return "Search";
  if (pathname.startsWith("/admin")) return "Settings";
  if (pathname.startsWith("/add-library")) return "Add Library";
  if (pathname.startsWith("/setup")) return "Setup";
  if (pathname.startsWith("/connect")) return "Server";
  if (pathname.startsWith("/watch")) return titleDataName || "Now Playing";
  return "";
}

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFullscreen = useIsFullscreen();
  const isHome = pathname === "/";

  const { data: libraries } = useQuery(queries.libraries());

  const titleMatch = pathname.match(/^\/title\/([^/?#]+)/);
  const titleId = titleMatch ? titleMatch[1] : null;
  const { data: titleData } = useQuery({
    ...queries.title(titleId ?? ""),
    enabled: !!titleId,
  });

  const pageTitle = resolvePageTitle(pathname, titleData?.item?.name, libraries);

  const handleBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      void router.navigate({ to: "/" });
    }
  };

  const movieCount = libraries
    ? libraries.filter((l) => l.type === "movies").reduce((sum, l) => sum + (l.counts?.items ?? 0), 0)
    : null;
  const tvCount = libraries
    ? libraries.filter((l) => l.type === "tv").reduce((sum, l) => sum + (l.counts?.items ?? 0), 0)
    : null;

  // Build the list of active links.
  // "if movies / tv shows any one do not have any title, hide that /library/tv or /library/movies nav"
  const navLinks = [
    { to: "/", label: "Home", icon: Home, params: undefined },
    ...(movieCount === null || movieCount > 0
      ? [{ to: "/library/$kind" as const, label: "Movies", icon: Film, params: { kind: "movies" as const } }]
      : []),
    ...(tvCount === null || tvCount > 0
      ? [{ to: "/library/$kind" as const, label: "TV Shows", icon: Tv, params: { kind: "tv" as const } }]
      : []),
  ];

  const electronMac = isElectronMac();

  useEffect(() => {
    if (window.electronAPI?.onNavigate) {
      const unsub = window.electronAPI.onNavigate((to) => {
        router.navigate({ to: to as any });
      });
      return unsub;
    }
  }, [router]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 15);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className={cx(
        "sticky top-0 z-40 select-none px-3 sm:px-6 md:px-8",
        "transition-[background-color,border-color] duration-200 ease-out",
        scrolled
          ? "border-b border-line bg-canvas/95 backdrop-blur-md"
          : "border-b border-transparent bg-canvas/80 backdrop-blur-sm",
      )}
    >
      <div className="mx-auto max-w-[1500px]">
        {/* Main top header row — three equal tracks keep the nav centered
            whether the left slot holds the logo or the back button. */}
        <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-2 sm:h-14 sm:gap-6">
          {/* Left section:
              - On Home ("/"): brand logo icon + "Plexy" link
              - On sub-pages: Back button + current page / title name (e.g. "Mindhunter") */}
          <div
            style={{
              WebkitAppRegion: "no-drag",
              paddingLeft: electronMac && !isFullscreen ? "88px" : undefined,
            } as React.CSSProperties}
            className="flex min-w-0 items-center gap-2 justify-self-start"
          >
            {isHome ? (
              <Link
                to="/"
                aria-label="Plexy home"
                className="group flex min-w-0 items-center gap-2 p-1 transition-transform active:scale-97"
              >
                <img src="/icon.svg" alt="" className="h-6 w-6 shrink-0" />
                <span className="font-sans text-base font-bold tracking-tight text-ink transition-colors group-hover:text-ink/80">
                  Plexy
                </span>
              </Link>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <BackButton onClick={handleBack} label={`Back to previous page`} />
                {pageTitle && (
                  <span
                    title={pageTitle}
                    className="truncate font-sans text-base font-bold tracking-tight text-ink"
                  >
                    {pageTitle}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Desktop Navigation Links */}
          <nav
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="hidden items-center gap-0.5 justify-self-center sm:flex"
            aria-label="Main Navigation"
          >
            {navLinks.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                params={"params" in l ? l.params : undefined}
                className="whitespace-nowrap px-3 py-1.5 text-xs md:text-sm font-medium text-ink-muted transition-colors hover:text-ink active:scale-95 [&.active]:text-ink"
                activeOptions={{ exact: l.label === "Home" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Right section: Search + Settings */}
          <div
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="flex items-center gap-1 justify-self-end"
          >
            <Link
              to="/connect"
              aria-label="Server connection"
              title="Server connection"
              className="inline-flex h-8 w-8 items-center justify-center text-ink-muted transition-colors hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 [&.active]:text-ink"
            >
              <Server size={17} />
            </Link>

            <Link
              to="/search"
              aria-label="Search"
              title="Search"
              className="inline-flex h-8 w-8 items-center justify-center text-ink-muted transition-colors hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 [&.active]:text-ink"
            >
              <Search size={17} />
            </Link>

            <Link to="/account" title="My account" aria-label="My account" className="inline-flex h-8 w-8 items-center justify-center text-ink-muted hover:text-ink"><UserRound size={17} /></Link>

            {/* Server settings are visible only to a local administrator. */}
            {getClientRuntime().canManageServer && <Link
              to="/admin"
              search={{ tab: "settings" }}
              aria-label="Settings"
              title="Settings"
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center text-ink-muted transition-colors hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              <Settings size={17} />
            </Link>}
          </div>
        </div>

      </div>
    </header>
  );
}
