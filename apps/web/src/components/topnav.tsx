/// Top navigation — sticky header that transitions to a solid blur on scroll,
/// with an intelligent responsive layout for desktop & mobile,
/// zero-title library filtering, and interactive feedback.
import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, Settings, Film, Tv, Home } from "lucide-react";
import { queries } from "../queries";
import { cx } from "./poster";

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const router = useRouter();
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 15);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-40 px-3 sm:px-6 md:px-8",
        "transition-[background-color,border-color,backdrop-filter] duration-200 ease-out",
        scrolled
          ? "border-b border-line/80 bg-canvas/90 backdrop-blur-md shadow-xs shadow-black/20"
          : "border-b border-transparent bg-gradient-to-b from-canvas/90 via-canvas/60 to-transparent backdrop-blur-xs",
      )}
    >
      <div className="mx-auto max-w-[1500px]">
        {/* Main top header row */}
        <div className="flex h-14 sm:h-16 items-center justify-between gap-2 sm:gap-6">
          {/* Left section: Back button + Plexy logo */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {canGoBack && (
              <button
                type="button"
                onClick={() => router.history.back()}
                aria-label="Go back"
                title="Back"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-all hover:bg-surface hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
              >
                <ArrowLeft size={18} />
              </button>
            )}

            <Link
              to="/"
              className="group flex items-center gap-2 rounded-lg p-1 transition-transform active:scale-97"
            >
              <img
                src="/icon.svg"
                alt="Plexy"
                className="h-7 w-7 transition-transform duration-200 group-hover:scale-105"
              />
              <span className="font-display text-lg sm:text-xl font-black tracking-wider text-brand-text transition-[filter] group-hover:brightness-110">
                PLEXY
              </span>
            </Link>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden sm:flex items-center gap-1.5" aria-label="Main Navigation">
            {navLinks.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                params={"params" in l ? l.params : undefined}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs md:text-sm font-medium text-ink-muted transition-all hover:text-ink hover:bg-surface/60 active:scale-95 [&.active]:text-ink [&.active]:bg-surface [&.active]:border [&.active]:border-line/60 [&.active]:shadow-xs"
                activeOptions={{ exact: l.label === "Home" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Right section: Search + Settings */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              to="/search"
              aria-label="Search"
              title="Search"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-all hover:bg-surface hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 [&.active]:bg-surface [&.active]:text-ink"
            >
              <Search size={18} />
            </Link>

            {/* Settings button - desktop only (mobile accesses via bottom bar) */}
            <Link
              to="/admin"
              aria-label="Settings"
              title="Settings"
              className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-all hover:bg-surface hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            >
              <Settings size={18} />
            </Link>
          </div>
        </div>

      </div>
    </header>
  );
}
