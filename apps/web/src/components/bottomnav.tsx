/// Mobile Bottom Navigation Bar
/// Provides thumb-accessible navigation on mobile devices for Home, Libraries and Settings.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, Film, Tv, Settings } from "lucide-react";
import { queries } from "../queries";
import { cx } from "./poster";

export function BottomNav() {
  const { data: libraries } = useQuery(queries.libraries());

  const movieCount = libraries
    ? libraries.filter((l) => l.type === "movies").reduce((sum, l) => sum + (l.counts?.items ?? 0), 0)
    : null;
  const tvCount = libraries
    ? libraries.filter((l) => l.type === "tv").reduce((sum, l) => sum + (l.counts?.items ?? 0), 0)
    : null;

  const items = [
    { to: "/" as const, label: "Home", icon: Home, params: undefined },
    ...(movieCount === null || movieCount > 0
      ? [{ to: "/library/$kind" as const, label: "Movies", icon: Film, params: { kind: "movies" as const } }]
      : []),
    ...(tvCount === null || tvCount > 0
      ? [{ to: "/library/$kind" as const, label: "TV Shows", icon: Tv, params: { kind: "tv" as const } }]
      : []),
    { to: "/admin" as const, label: "Settings", icon: Settings, params: undefined },
  ];

  return (
    <nav
      className={cx(
        "fixed bottom-0 inset-x-0 z-40 sm:hidden",
        "border-t border-line/70 bg-canvas/95 backdrop-blur-md shadow-lg shadow-black/40",
        "pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 px-2",
      )}
      aria-label="Mobile Navigation Bar"
    >
      <div className="flex items-center justify-around">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            params={"params" in item ? item.params : undefined}
            activeOptions={{ exact: item.label === "Home" || item.label === "Settings" }}
            className={cx(
              "group flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center select-none",
              "text-ink-muted transition-all duration-150 active:scale-95",
              "[&.active]:text-brand-text",
            )}
          >
            <div className="relative flex h-7 w-7 items-center justify-center rounded-full transition-colors group-hover:bg-white/5 group-[.active]:bg-brand/15">
              <item.icon size={19} className="transition-transform group-[.active]:scale-110" />
            </div>
            <span className="text-[10px] font-medium tracking-tight transition-colors">
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
