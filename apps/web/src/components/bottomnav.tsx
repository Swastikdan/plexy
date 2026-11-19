/// Mobile bottom navigation bar.
/// Thumb-accessible tabs with a quiet active pill; the account and every
/// server control share one destination because they share one dashboard.
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, Library, UserRound } from "lucide-react";
import { cx } from "../lib/cx";
import { accountRequest, getSignedInUser, type AccountUser } from "../auth";
import { UserAvatar } from "./user-avatar";

export function BottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const account = useQuery({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser }>("/me"),
    staleTime: 30_000,
    retry: false,
  });

  const items = [
    { to: "/" as const, label: "Home", icon: Home, params: undefined },
    {
      to: "/library/$kind" as const,
      label: "Library",
      icon: Library,
      params: { kind: "all" as const },
    },
    { to: "/settings" as const, label: "You", icon: UserRound, params: undefined },
  ];

  return (
    <nav
      className={cx(
        "glass fixed inset-x-0 bottom-0 z-40 border-t border-border/80 lg:hidden",
        "px-3 pb-[max(env(safe-area-inset-bottom),0.55rem)] pt-1.5",
      )}
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-around">
        {items.map((item) => {
          const active =
            item.label === "Home"
              ? pathname === "/"
              : item.label === "Library"
                ? pathname.startsWith("/library")
                : pathname.startsWith("/settings");
          return (
            <Link
              key={item.label}
              to={item.to}
              params={"params" in item ? item.params : undefined}
              aria-current={active ? "page" : undefined}
              className={cx(
                "group flex flex-1 flex-col items-center justify-center gap-0.5 py-0.5 text-center select-none",
                "transition-[color,transform] duration-150 active:scale-95",
                active ? "text-foreground" : "text-muted",
              )}
            >
              <span
                className={cx(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
                  active && "bg-surface-secondary",
                )}
              >
                {item.label === "You" ? (
                  <UserAvatar
                    user={account.data?.user ?? getSignedInUser()}
                    size={22}
                    alt=""
                    className={cx(
                      "ring-0 transition-[border-color,transform] duration-150",
                      active && "border-accent/50",
                    )}
                  />
                ) : (
                  <item.icon
                    size={18}
                    strokeWidth={1.9}
                    className={cx("transition-transform duration-200", active && "scale-[1.06]")}
                  />
                )}
              </span>
              <span className="text-[9.5px] font-semibold tracking-[0.01em]">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
