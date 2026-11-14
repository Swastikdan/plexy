/// Top navigation — sticky header that transitions to a solid blur on scroll,
/// with an intelligent responsive layout for desktop & mobile,
/// zero-title library filtering, and interactive feedback.
import { useEffect, useState } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Film, Tv, Home, Server } from "lucide-react";
import { queries } from "../queries";
import { cx } from "../lib/cx";
import { useIsFullscreen } from "../lib/use-fullscreen";
import { isElectronMac } from "../lib/platform";
import { getSignedInUser } from "../auth";
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
  if (pathname.startsWith("/person/")) return "Cast";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/admin")) return "Settings";
  if (pathname.startsWith("/account")) return "Settings";
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
  const signedIn = getSignedInUser();

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
          ? "border-b border-border bg-background/95 backdrop-blur-md"
          : "border-b border-transparent bg-background/80 backdrop-blur-sm",
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
                <span className="font-sans text-base font-bold tracking-tight text-foreground transition-colors group-hover:text-foreground/80">
                  Plexy
                </span>
              </Link>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <BackButton onClick={handleBack} label={`Back to previous page`} />
                {pageTitle && (
                  <span
                    title={pageTitle}
                    className="truncate font-sans text-base font-bold tracking-tight text-foreground"
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
                className="whitespace-nowrap px-3 py-1.5 text-xs md:text-sm font-medium text-muted transition-colors hover:text-foreground active:scale-95 [&.active]:text-foreground"
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
            {!window.electronAPI?.localOnly && <Link
              to="/connect"
              aria-label="Server connection"
              title="Server connection"
              className="inline-flex h-8 w-8 items-center justify-center text-muted transition-colors hover:text-foreground active:scale-95 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2 [&.active]:text-foreground"
            >
              <Server size={17} />
            </Link>}

            <Link
              to="/search"
              aria-label="Search"
              title="Search"
              className="inline-flex h-8 w-8 items-center justify-center text-muted transition-colors hover:text-foreground active:scale-95 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2 [&.active]:text-foreground"
            >
              <Search size={17} />
            </Link>

            {/* One entry point for the account and server dashboard. The
                avatar keeps the header quiet while making "this is you"
                obvious on desktop. */}
            <Link
              to="/settings"
              search={{ tab: "overview" }}
              aria-label="Account and settings"
              title="Account and settings"
              className="group ml-0.5 hidden h-8 items-center justify-center rounded-full p-0.5 text-muted transition-colors hover:text-foreground active:scale-95 focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2 sm:inline-flex [&.active]:text-foreground"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-secondary text-[11px] font-bold uppercase text-foreground transition-colors group-hover:border-foreground/25 group-hover:bg-surface-tertiary">
                {signedIn?.username.slice(0, 1) ?? "?"}
              </span>
            </Link>
          </div>
        </div>

      </div>
    </header>
  );
}
