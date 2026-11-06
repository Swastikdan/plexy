import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountRequest, type AccountUser } from "../auth";
import { queries } from "../queries";
import { Button } from "./ui/button";

const input =
  "mt-2 h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm";

export function UserManagement() {
  const me = useQuery({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser }>("/me"),
  });
  return me.data?.user.role === "admin" ? <Users /> : null;
}

function Users() {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => accountRequest<{ users: AccountUser[] }>("/users"),
  });
  const cache = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="space-y-5 rounded-xl border border-line p-5">
      <h2 className="text-xl font-bold">Users & permissions</h2>
      <p className="text-sm text-ink-muted">
        New users have no library access until you grant it. Administrators have
        full access. Each user creates their own pairing keys.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await accountRequest("/users", {
              username,
              password,
              role: "user",
            });
            setUsername("");
            setPassword("");
            await cache.invalidateQueries({ queryKey: ["users"] });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not create user.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          New username
          <input
            required
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={input}
          />
        </label>
        <label className="block text-sm">
          Initial password
          <input
            required
            minLength={12}
            maxLength={128}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </label>
        <Button disabled={busy} type="submit">
          Create user
        </Button>
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
      </form>
      {users.data?.users.map((user) => (
        <UserEditor
          key={`${user.id}:${user.disabled}:${user.role}:${user.maxAge}:${user.blockUnrated}`}
          user={user}
        />
      ))}
    </section>
  );
}
type Rule = {
  scope: "library" | "folder" | "item";
  target: string;
  allowed: boolean | number;
};
function UserEditor({ user }: { user: AccountUser }) {
  const cache = useQueryClient();
  const [settings, setSettings] = useState(user);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const libraries = useQuery(queries.libraries());
  const titles = useQuery(queries.items({}));
  const existing = useQuery({
    queryKey: ["rules", user.id],
    queryFn: () => accountRequest<{ rules: Rule[] }>(`/users/${user.id}/rules`),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = rules ?? existing.data?.rules ?? [];
  return (
    <details className="border-t border-line pt-4">
      <summary className="cursor-pointer font-semibold">
        {user.username} · {user.role}
        {user.disabled ? " · disabled" : ""}
      </summary>
      <form
        className="mt-4 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await accountRequest(
              `/users/${user.id}`,
              {
                role: settings.role,
                disabled: settings.disabled,
                maxAge: settings.maxAge,
                blockUnrated: settings.blockUnrated,
              },
              "PUT",
            );
            if (rules)
              await accountRequest(
                `/users/${user.id}/rules`,
                {
                  rules: rules.map((rule) => ({
                    ...rule,
                    allowed: Boolean(rule.allowed),
                  })),
                },
                "PUT",
              );
            await cache.invalidateQueries({ queryKey: ["rules", user.id] });
            await cache.invalidateQueries({ queryKey: ["users"] });
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not save permissions.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          Role
          <select
            className={input}
            value={settings.role}
            onChange={(e) =>
              setSettings({
                ...settings,
                role: e.target.value as AccountUser["role"],
              })
            }
          >
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.disabled}
            onChange={(e) =>
              setSettings({ ...settings, disabled: e.target.checked })
            }
          />
          Disable account
        </label>
        <label className="block text-sm">
          Maximum maturity age
          <select
            className={input}
            value={settings.maxAge ?? "none"}
            onChange={(e) =>
              setSettings({
                ...settings,
                maxAge:
                  e.target.value === "none" ? null : Number(e.target.value),
              })
            }
          >
            <option value="none">No maturity limit</option>
            {[0, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 21].map((age) => (
              <option key={age} value={age}>
                {age} and below
              </option>
            ))}
          </select>
        </label>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.blockUnrated}
            onChange={(e) =>
              setSettings({ ...settings, blockUnrated: e.target.checked })
            }
          />
          Block unrated titles when a maturity limit is set
        </label>
        <p className="text-xs text-ink-muted">
          Choose a library, folder, or title from the suggestions, or paste the
          ID from a title link. Exclusions override grants; maturity
          restrictions always apply.
        </p>
        <datalist id={`libraries-${user.id}`}>
          {libraries.data?.map((library) => (
            <option key={library.id} value={library.id}>
              {library.name}
            </option>
          ))}
        </datalist>
        <datalist id={`folders-${user.id}`}>
          {libraries.data?.flatMap((library) =>
            library.paths.map((path) => (
              <option key={path} value={path}>
                {library.name}
              </option>
            )),
          )}
        </datalist>
        <datalist id={`items-${user.id}`}>
          {titles.data?.items.map((item) => (
            <option key={item.id} value={item.publicId || item.id}>
              {item.name}
            </option>
          ))}
        </datalist>
        {shown.map((rule, index) => (
          <div key={index} className="flex flex-wrap gap-2">
            <select
              aria-label="Permission scope"
              value={rule.scope}
              className="h-10 rounded border border-line bg-surface px-2"
              onChange={(e) =>
                setRules(
                  shown.map((r, i) =>
                    i === index
                      ? { ...r, scope: e.target.value as Rule["scope"] }
                      : r,
                  ),
                )
              }
            >
              <option value="library">Library</option>
              <option value="folder">Folder</option>
              <option value="item">Title</option>
            </select>
            <input
              list={`${rule.scope === "library" ? "libraries" : rule.scope === "folder" ? "folders" : "items"}-${user.id}`}
              aria-label="Permission target"
              required
              className="h-10 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-sm"
              value={rule.target}
              onChange={(e) =>
                setRules(
                  shown.map((r, i) =>
                    i === index ? { ...r, target: e.target.value } : r,
                  ),
                )
              }
            />
            <select
              aria-label="Access"
              className="h-10 rounded border border-line bg-surface px-2"
              value={rule.allowed ? "allow" : "deny"}
              onChange={(e) =>
                setRules(
                  shown.map((r, i) =>
                    i === index
                      ? { ...r, allowed: e.target.value === "allow" }
                      : r,
                  ),
                )
              }
            >
              <option value="allow">Allow</option>
              <option value="deny">Exclude</option>
            </select>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setRules(shown.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="block text-sm underline"
          disabled={existing.isLoading}
          onClick={() =>
            setRules([
              ...shown,
              { scope: "library", target: "", allowed: true },
            ])
          }
        >
          Add permission
        </button>
        {error && (
          <p role="alert" className="text-red-400">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={busy || existing.isLoading}
        >
          {busy ? "Saving…" : "Save permissions"}
        </Button>
      </form>
    </details>
  );
}
