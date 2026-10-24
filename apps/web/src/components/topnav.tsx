/// Top navigation — Netflix-style sticky header that transitions to solid blur on scroll.
import { useEffect, useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { Film, Tv, Search, Settings } from "lucide-react";
import { cx } from "./poster";

const links = [
  { to: "/", label: "Home", icon: null, params: undefined },
  { to: "/library/$kind", label: "Movies", icon: Film, params: { kind: "movies" } },
  { to: "/library/$kind", label: "TV Shows", icon: Tv, params: { kind: "tv" } },
] as const;

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const search = useSearch({ from: "/search", shouldThrow: false }) as { q?: string } | undefined;
  const q = search?.q ?? "";

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
        "transition-all duration-300 ease-out",
        scrolled
          ? "border-b border-white/10 bg-[#141414]/95 backdrop-blur-md shadow-lg shadow-black/40"
          : "border-b border-transparent bg-gradient-to-b from-black/80 via-black/40 to-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-8">
        <Link to="/" className="group flex items-center gap-2.5">
          <img src="/icon.svg" alt="Plexy Logo" className="h-7 w-7 transition-transform group-hover:scale-105" />
          <span className="font-display text-xl font-black tracking-wider text-[#E50914] group-hover:brightness-110 transition-all">
            PLEXY
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {links.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              params={"params" in l ? l.params : undefined}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-white [&.active]:font-semibold [&.active]:text-white"
              activeOptions={{ exact: l.label === "Home" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <label
            className={cx(
              "flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5",
              "text-ink-muted text-sm transition-all focus-within:border-white/40 focus-within:bg-black/60 focus-within:w-64",
            )}
          >
            <Search size={15} className="shrink-0 text-ink-muted" aria-hidden />
            <input
              type="search"
              value={q ?? ""}
              placeholder="Titles, genres…"
              onChange={(e) =>
                navigate({ to: "/search", search: { q: e.target.value }, replace: true })
              }
              className="w-32 bg-transparent text-white placeholder:text-ink-muted/70 outline-none transition-all sm:w-48"
            />
          </label>
          <Link
            to="/admin"
            aria-label="Server settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <Settings size={18} />
          </Link>
        </div>
      </div>
    </header>
  );
}
