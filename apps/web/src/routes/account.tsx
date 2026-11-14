/// My account moved into the unified settings dashboard.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/account")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings",
      search: { tab: "account" },
      replace: true,
    });
  },
});
