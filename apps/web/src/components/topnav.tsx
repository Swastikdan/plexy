/// Top navigation — sticky header that transitions to a solid blur on scroll,
/// with a back button away from Home and a quiet search field.
import { useEffect, useState } from "react";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Search, Settings } from "lucide-react";
import { cx } from "./poster";

const links = [
  { to: "/", label: "Home", icon: null, params: undefined },
  { to: "/library/$kind", label: "Movies", icon: null, params: { kind: "movies" } },
  { to: "/library/$kind", label: "TV Shows", icon: null, params: { kind: "tv" } },
] as const;

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/search", shouldThrow: false }) as { q?: string } | undefined;
  const routeQ = search?.q ?? "";
  const [q, setQ] = useState(routeQ);
  // The back affordance appears everywhere except Home itself.
  const canGoBack = router.state.location.pathname !== "/";

  useEffect(() => {
    setQ(routeQ);
  }, [routeQ]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 15);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-40 px-4 sm:px-8",
        "transition-[background-color,border-color] duration-300 ease-out",
        scrolled
          ? "border-b border-line bg-canvas/95"
          : "border-b border-transparent bg-gradient-to-b from-canvas/80 via-canvas/40 to-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-2 sm:gap-6">
        {canGoBack && (
          <button
            onClick={() => router.history.back()}
            aria-label="Go back"
            title="Back"
            className="-mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none text-ink-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
          >
            <ArrowLeft size={19} />
          </button>
        )}

        <Link to="/" className="group flex items-center gap-2.5">
          <img
            src="/icon.svg"
            alt="Plexy"
            className="h-7 w-7 transition-transform group-hover:scale-105"
          />
          <span className="hidden min-[400px]:inline font-display text-xl font-black tracking-wider text-brand-text transition-[filter] group-hover:brightness-110">
            PLEXY
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {links.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              params={"params" in l ? l.params : undefined}
              className="whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink sm:px-3 sm:text-sm [&.active]:font-semibold [&.active]:text-ink"
              activeOptions={{ exact: l.label === "Home" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({ to: "/search", search: { q } });
            }}
            className={cx(
              "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-none border border-line bg-surface/70 px-3 sm:flex-none sm:w-44 sm:px-3.5",
              "text-ink-muted text-sm transition-[border-color,background-color,width] duration-200 ease-out",
              "focus-within:border-brand/70 focus-within:bg-surface",
              "focus-within:outline-1 focus-within:outline-transparent sm:focus-within:w-72",
            )}
          >
            <button
              type="submit"
              aria-label="Search"
              title="Search"
              className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:text-ink"
            >
              <Search size={15} aria-hidden />
            </button>
            <input
              type="search"
              value={q}
              placeholder="Search titles…"
              aria-label="Search your library"
              enterKeyHint="search"
              onChange={(e) => setQ(e.target.value)}
              className="w-full min-w-0 bg-transparent text-ink placeholder:text-ink-muted/70 outline-none"
            />
          </form>
          <Link
            to="/admin"
            aria-label="Settings"
            title="Settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-none text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
          >
            <Settings size={18} />
          </Link>
        </div>
      </div>
    </header>
  );
}
