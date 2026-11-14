/// User management lives in its own Server → Users section. Creating an
/// account, changing a role, and granting library access are separate, focused
/// dialogs so the roster stays scannable.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountRequest, type AccountUser } from "../auth";
import { queries } from "../queries";
import {
  Button,
  Input,
  ListBox,
  Modal,
  Select,
  Switch,
} from "@heroui/react";
import {
  Check,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { PageLoader } from "./page-loader";

const ERROR_TEXT = "text-danger-soft-foreground";

/// Maturity ceilings accepted by the server (0–21). 0 means "all ages".
const MATURITY_AGES = [0, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 21];

export function UserManagement() {
  const me = useQuery({
    queryKey: ["account"],
    queryFn: () => accountRequest<{ user: AccountUser }>("/me"),
  });
  if (me.data?.user.role !== "admin") return null;
  return <Users currentUserId={me.data.user.id} />;
}

function Users({ currentUserId }: { currentUserId: number }) {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => accountRequest<{ users: AccountUser[] }>("/users"),
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountUser | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
            <UsersIcon size={17} className="text-muted" />
            Users
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            People who can sign in to this Plexy server. New accounts start with
            no library access; administrators always have full access. Everyone
            pairs their own devices from Settings.
          </p>
        </div>
        <Button
          variant="primary"
          onPress={() => setCreating(true)}
          className="shrink-0 self-start"
        >
          <UserPlus size={15} />
          New user
        </Button>
      </div>

      {users.isError && (
        <p role="alert" className={`text-sm ${ERROR_TEXT}`}>
          {users.error.message}
        </p>
      )}

      {users.isLoading && !users.data ? (
        <PageLoader label="Loading users" className="min-h-[24vh]" />
      ) : users.data?.users.length ? (
        <ul className="overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-sm">
          {users.data.users.map((user) => (
            <UserRow
              key={`${user.id}:${user.disabled}:${user.role}:${user.maxAge}:${user.blockUnrated}`}
              user={user}
              isSelf={user.id === currentUserId}
              onManage={() => setEditing(user)}
            />
          ))}
        </ul>
      ) : (
        !users.isError && (
          <p className="rounded-2xl border border-border/70 bg-surface px-4 py-6 text-center text-sm text-muted">
            No accounts yet. Create the first one to let someone sign in.
          </p>
        )
      )}

      {creating && <CreateUserDialog onClose={() => setCreating(false)} />}
      {editing && (
        <EditUserDialog
          key={editing.id}
          user={editing}
          isSelf={editing.id === currentUserId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Role and restriction badges, shared by the roster and the editor header. */
function RoleBadge({ role }: { role: AccountUser["role"] }) {
  return (
    <span
      className={
        role === "admin"
          ? "inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-soft-foreground"
          : "inline-flex items-center rounded-full border border-border/70 bg-surface-secondary px-2 py-0.5 text-[11px] font-semibold text-muted"
      }
    >
      {role === "admin" && <ShieldCheck size={11} />}
      {role === "admin" ? "Administrator" : "User"}
    </span>
  );
}

function UserRow({
  user,
  isSelf,
  onManage,
}: {
  user: AccountUser;
  isSelf: boolean;
  onManage: () => void;
}) {
  const restriction =
    user.maxAge === null
      ? "No maturity limit"
      : `Maturity up to ${user.maxAge}${user.blockUnrated ? " · unrated blocked" : ""}`;
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-b-0 sm:px-5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-sm font-semibold uppercase text-foreground"
      >
        {user.username.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {user.username}
          </span>
          {isSelf && (
            <span className="rounded-full border border-border/70 bg-surface-secondary px-2 py-0.5 text-[11px] font-semibold text-muted">
              You
            </span>
          )}
          <RoleBadge role={user.role} />
          {user.disabled && (
            <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger-soft-foreground">
              Disabled
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-muted">
          {user.disabled ? "Cannot sign in until re-enabled" : restriction}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onPress={onManage}
        className="ml-auto shrink-0"
      >
        <Pencil size={13} />
        Manage
      </Button>
    </li>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const cache = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!username.trim()) {
      setError("Enter a username.");
      return;
    }
    if (password.length < 12) {
      setError("The initial password must be at least 12 characters.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await accountRequest("/users", {
        username: username.trim(),
        password,
        role: "user",
      });
      await cache.invalidateQueries({ queryKey: ["users"] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create user.");
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[min(94vw,480px)] max-w-none">
            <Modal.Header className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Modal.Heading className="font-sans text-xl font-bold text-foreground">
                  New user
                </Modal.Heading>
                <p className="mt-1 text-xs text-muted">
                  They can change this password after signing in.
                </p>
              </div>
              <Modal.CloseTrigger
                className="text-muted transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body>
              <form
                id="create-user-form"
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <label className="block text-sm">
                  Username
                  <Input
                    required
                    autoFocus
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
                  <span className="mt-1.5 block text-xs text-muted">
                    At least 12 characters.
                  </span>
                </label>
                {error && (
                  <p role="alert" className={`text-sm ${ERROR_TEXT}`}>
                    {error}
                  </p>
                )}
              </form>
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose} isDisabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onPress={() => void submit()} isDisabled={busy}>
                {busy ? "Creating…" : "Create user"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

type Rule = {
  scope: "library" | "folder" | "item";
  target: string;
  allowed: boolean | number;
};

function EditUserDialog({
  user,
  isSelf,
  onClose,
}: {
  user: AccountUser;
  isSelf: boolean;
  onClose: () => void;
}) {
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

  const submit = async () => {
    if (busy || existing.isLoading) return;
    if (rules?.some((rule) => !rule.target.trim())) {
      setError("Every permission needs a library, folder, or title target.");
      return;
    }
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
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[min(94vw,680px)] max-w-none">
            <Modal.Header className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Modal.Heading className="truncate font-sans text-xl font-bold text-foreground">
                  {user.username}
                </Modal.Heading>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <RoleBadge role={settings.role} />
                  {settings.disabled && (
                    <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger-soft-foreground">
                      Disabled
                    </span>
                  )}
                </div>
              </div>
              <Modal.CloseTrigger
                className="text-muted transition-colors hover:text-foreground"
                aria-label="Close"
              >
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="space-y-5">
              <form
                id="edit-user-form"
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <fieldset className="space-y-3" disabled={busy}>
                  <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Account
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      Role
                      <Select
                        aria-label="Role"
                        selectedKey={settings.role}
                        isDisabled={isSelf || busy}
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
                    <div className="space-y-1.5">
                      <span className="block text-sm">Account status</span>
                      <Switch
                        isSelected={settings.disabled}
                        isDisabled={isSelf || busy}
                        onChange={(isSelected) =>
                          setSettings({ ...settings, disabled: isSelected })
                        }
                        className="w-full rounded-xl border border-border/60 bg-surface-secondary/50 px-3 py-2"
                      >
                        <Switch.Content className="flex w-full items-center justify-between gap-4">
                          <span className="text-sm">Disable sign-in</span>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Content>
                      </Switch>
                    </div>
                  </div>
                  {isSelf && (
                    <p className="text-xs text-muted">
                      You cannot disable or demote your own administrator
                      account.
                    </p>
                  )}
                </fieldset>

                <fieldset className="space-y-3 border-t border-border/60 pt-5" disabled={busy}>
                  <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Playback restrictions
                  </legend>
                  <label className="block text-sm">
                    Maximum maturity rating
                    <Select
                      aria-label="Maximum maturity rating"
                      selectedKey={
                        settings.maxAge == null ? "none" : String(settings.maxAge)
                      }
                      isDisabled={busy}
                      onSelectionChange={(key) =>
                        setSettings({
                          ...settings,
                          maxAge:
                            String(key) === "none" ? null : Number(key),
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
                          {MATURITY_AGES.map((age) => (
                            <ListBox.Item
                              key={age}
                              id={String(age)}
                              textValue={`${age} and below`}
                            >
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
                    isDisabled={busy}
                    onChange={(isSelected) =>
                      setSettings({ ...settings, blockUnrated: isSelected })
                    }
                    className="w-full"
                  >
                    <Switch.Content className="flex w-full items-center justify-between gap-4">
                      <span className="text-sm">
                        Hide unrated titles when a maturity limit is set
                      </span>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Content>
                  </Switch>
                </fieldset>

                <fieldset className="space-y-3 border-t border-border/60 pt-5" disabled={busy}>
                  <legend className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Library access
                  </legend>
                  <p className="text-xs leading-relaxed text-muted">
                    Choose a library, folder, or title from the suggestions, or
                    paste the ID from a title link. Exclusions override grants;
                    maturity restrictions always apply.
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

                  {existing.isLoading ? (
                    <p className="text-xs text-muted">Loading access rules…</p>
                  ) : existing.isError ? (
                    <p role="alert" className={`text-xs ${ERROR_TEXT}`}>
                      {existing.error.message}
                    </p>
                  ) : shown.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted">
                      No access yet. Add a library, folder, or title grant
                      before this account can browse.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {shown.map((rule, index) => (
                        <div
                          key={index}
                          className="space-y-2 rounded-xl border border-border/60 bg-surface-secondary/40 p-3"
                        >
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="min-w-0 flex-1 text-xs font-medium text-muted">
                              Scope
                              <Select
                                aria-label="Permission scope"
                                selectedKey={rule.scope}
                                isDisabled={busy}
                                onSelectionChange={(key) =>
                                  setRules(
                                    shown.map((r, i) =>
                                      i === index
                                        ? {
                                            ...r,
                                            scope: String(key) as Rule["scope"],
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                className="mt-1 w-full"
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
                                      <ListBox.Item
                                        key={option.id}
                                        id={option.id}
                                        textValue={option.label}
                                      >
                                        {option.label}
                                        <ListBox.ItemIndicator />
                                      </ListBox.Item>
                                    ))}
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </label>
                            <label className="w-32 shrink-0 text-xs font-medium text-muted">
                              Access
                              <Select
                                aria-label="Access"
                                selectedKey={rule.allowed ? "allow" : "deny"}
                                isDisabled={busy}
                                onSelectionChange={(key) =>
                                  setRules(
                                    shown.map((r, i) =>
                                      i === index
                                        ? {
                                            ...r,
                                            allowed: String(key) === "allow",
                                          }
                                        : r,
                                    ),
                                  )
                                }
                                className="mt-1 w-full"
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
                            </label>
                            <button
                              type="button"
                              aria-label="Remove permission"
                              title="Remove permission"
                              onClick={() =>
                                setRules(shown.filter((_, i) => i !== index))
                              }
                              disabled={busy}
                              className="mb-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-tertiary hover:text-danger-soft-foreground"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <label className="block text-xs font-medium text-muted">
                            Target
                            <Input
                              list={`${rule.scope === "library" ? "libraries" : rule.scope === "folder" ? "folders" : "items"}-${user.id}`}
                              aria-label="Permission target"
                              required
                              disabled={busy}
                              className="mt-1 w-full"
                              value={rule.target}
                              onChange={(e) =>
                                setRules(
                                  shown.map((r, i) =>
                                    i === index
                                      ? { ...r, target: e.target.value }
                                      : r,
                                  ),
                                )
                              }
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={existing.isLoading || busy}
                    onPress={() =>
                      setRules([
                        ...shown,
                        { scope: "library", target: "", allowed: true },
                      ])
                    }
                  >
                    <Plus size={14} />
                    Add permission
                  </Button>
                </fieldset>

                {error && (
                  <p role="alert" className={`text-sm ${ERROR_TEXT}`}>
                    {error}
                  </p>
                )}
              </form>
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2">
              <Button variant="secondary" onPress={onClose} isDisabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onPress={() => void submit()}
                isDisabled={busy || existing.isLoading}
              >
                {busy ? (
                  "Saving…"
                ) : (
                  <>
                    <Check size={15} />
                    Save changes
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
