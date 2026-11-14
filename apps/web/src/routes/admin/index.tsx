/// Server administration moved into the unified settings dashboard. Legacy
/// bookmarks and the old tab names still land on the right section.
import { createFileRoute, redirect } from "@tanstack/react-router";

type LegacyTab = "libraries" | "review" | "users" | "settings" | "logs";

export const Route = createFileRoute("/admin/")({
  validateSearch: (search: Record<string, unknown>): { tab?: LegacyTab } => {
    const raw = String(search.tab ?? "");
    if (raw === "review" || raw === "users" || raw === "settings" || raw === "libraries" || raw === "logs") {
      return { tab: raw };
    }
    return {};
  },
  beforeLoad: ({ search }) => {
    const mapped =
      search.tab === "review"
        ? "matches"
        : search.tab === "settings" || search.tab === "logs"
          ? "server"
          : search.tab ?? "libraries";
    throw redirect({
      to: "/settings",
      search: { tab: mapped },
      replace: true,
    });
  },
});
