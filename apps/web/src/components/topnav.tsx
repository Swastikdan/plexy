/// Top navigation — sticky header that transitions to a solid blur on scroll,
/// with an intelligent responsive layout for desktop & mobile,
/// zero-title library filtering, and interactive feedback.
import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Settings, Film, Tv, Home, Server } from "lucide-react";
import { queries } from "../queries";
import { cx } from "./poster";
import { useIsFullscreen } from "../lib/use-fullscreen";
import { isElectronMac } from "../lib/platform";
import { BackButton } from "./back-button";

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
  const isFullscreen = useIsFullscreen();
  const canGoBack = router.state.location.pathname !== "/";

  // Check libraries to see whether movies or TV shows have titles
  const { data: libraries } = useQuery(queries.libraries());

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
          {/* Left section: a persistent brand home, preceded by Back on
              sub-pages so the app still reads as Plexy while navigating. */}
          <div
            style={{
              WebkitAppRegion: "no-drag",
              paddingLeft: electronMac && !isFullscreen ? "88px" : undefined,
            } as React.CSSProperties}
            className="flex min-w-0 items-center gap-1 justify-self-start sm:gap-2"
          >
            {canGoBack && <BackButton onClick={() => router.history.back()} />}
            <Link
              to="/"
              aria-label="Plexy home"
              className="group flex min-w-0 items-center gap-2 p-1 transition-transform active:scale-97"
            >
              <img src="/icon.svg" alt="" className="h-6 w-6 shrink-0" />
              <span
                className={cx(
                  "font-sans text-base font-bold tracking-tight text-ink transition-colors group-hover:text-ink/80",
                  canGoBack && "hidden min-[400px]:inline",
                )}
              >
                Plexy
              </span>
            </Link>
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

            {/* Settings button - desktop only (mobile accesses via bottom bar) */}
            <Link
              to="/admin"
              aria-label="Settings"
              title="Settings"
              className="hidden sm:inline-flex h-8 w-8 items-center justify-center text-ink-muted transition-colors hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              <Settings size={17} />
            </Link>
          </div>
        </div>

      </div>
    </header>
  );
}
