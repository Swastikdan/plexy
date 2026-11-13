import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountRequest, type AccountUser } from "../auth";
import { queries } from "../queries";
import { Button, Input, ListBox, Select, Switch } from "@heroui/react";

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
    <section className="space-y-5 rounded-xl border border-border p-5">
      <h2 className="text-xl font-bold">Users & permissions</h2>
      <p className="text-sm text-muted">
        New users have no library access until you grant it. Administrators have
        full access. Each user creates their own pairing codes.
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
          <Input
            required
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            className="mt-2"
          />
        </label>
        <label className="block text-sm">
          Initial password
          <Input
            required
            minLength={12}
            maxLength={128}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            className="mt-2"
          />
        </label>
        <Button isDisabled={busy} type="submit">
          Create user
        </Button>
        {error && (
          <p role="alert" className="text-danger-soft-foreground">
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
    <details className="border-t border-border pt-4">
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
          <Select
            aria-label="Role"
            selectedKey={settings.role}
            onSelectionChange={(key) =>
              setSettings({
                ...settings,
                role: String(key) as AccountUser["role"],
              })
            }
            className="mt-2 w-full"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="user" textValue="User">
                  User
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="admin" textValue="Administrator">
                  Administrator
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <Switch
          isSelected={settings.disabled}
          onChange={(isSelected) =>
            setSettings({ ...settings, disabled: isSelected })
          }
        >
          <Switch.Content>Disable account</Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
        <label className="block text-sm">
          Maximum maturity age
          <Select
            aria-label="Maximum maturity age"
            selectedKey={settings.maxAge == null ? "none" : String(settings.maxAge)}
            onSelectionChange={(key) =>
              setSettings({
                ...settings,
                maxAge: String(key) === "none" ? null : Number(key),
              })
            }
            className="mt-2 w-full"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="none" textValue="No maturity limit">
                  No maturity limit
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {[0, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 21].map((age) => (
                  <ListBox.Item key={age} id={String(age)} textValue={`${age} and below`}>
                    {age} and below
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <Switch
          isSelected={settings.blockUnrated}
          onChange={(isSelected) =>
            setSettings({ ...settings, blockUnrated: isSelected })
          }
        >
          <Switch.Content>Block unrated titles when a maturity limit is set</Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
        <p className="text-xs text-muted">
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
            <Select
              aria-label="Permission scope"
              selectedKey={rule.scope}
              onSelectionChange={(key) =>
                setRules(
                  shown.map((r, i) =>
                    i === index
                      ? { ...r, scope: String(key) as Rule["scope"] }
                      : r,
                  ),
                )
              }
              className="w-32 shrink-0"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {[
                    { id: "library", label: "Library" },
                    { id: "folder", label: "Folder" },
                    { id: "item", label: "Title" },
                  ].map((option) => (
                    <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Input
              list={`${rule.scope === "library" ? "libraries" : rule.scope === "folder" ? "folders" : "items"}-${user.id}`}
              aria-label="Permission target"
              required
              className="min-w-0 flex-1"
              value={rule.target}
              onChange={(e) =>
                setRules(
                  shown.map((r, i) =>
                    i === index ? { ...r, target: e.target.value } : r,
                  ),
                )
              }
            />
            <Select
              aria-label="Access"
              selectedKey={rule.allowed ? "allow" : "deny"}
              onSelectionChange={(key) =>
                setRules(
                  shown.map((r, i) =>
                    i === index ? { ...r, allowed: String(key) === "allow" } : r,
                  ),
                )
              }
              className="w-28 shrink-0"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="allow" textValue="Allow">
                    Allow
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  <ListBox.Item id="deny" textValue="Exclude">
                    Exclude
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onPress={() => setRules(shown.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          isDisabled={existing.isLoading}
          onPress={() =>
            setRules([
              ...shown,
              { scope: "library", target: "", allowed: true },
            ])
          }
        >
          Add permission
        </Button>
        {error && (
          <p role="alert" className="text-danger-soft-foreground">
            {error}
          </p>
        )}
        <Button
          type="submit"
          isDisabled={busy || existing.isLoading}
        >
          {busy ? "Saving…" : "Save permissions"}
        </Button>
      </form>
    </details>
  );
}
