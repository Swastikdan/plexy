import React, { useState } from "react";
import { View } from "react-native";
import type { LibraryItem } from "../../../api-client/src/types";
import { useClient } from "../context";
import { useResource } from "../hooks";
import { Button, Field, Heading, Label } from "../ui";
import {
  confirmAction,
  Feedback,
  Group,
  Refresh,
  ResourceState,
  useAdminAction,
} from "./shared";

type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  maxAge: number | null;
  blockUnrated: boolean;
};
type Rule = {
  scope: "library" | "folder" | "item";
  target: string;
  allowed: boolean | number;
};
export function AdminUsers() {
  const { api } = useClient();
  const resource = useResource(
    (signal) => api.request<{ users: User[] }>("/api/auth/users", { signal }),
    [api],
  );
  const libraries = useResource(
    (signal) =>
      api.request<{ libraries: LibraryItem[] }>("/api/libraries", { signal }),
    [api],
  );
  const action = useAdminAction(resource.retry);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const user = resource.value?.users.find((entry) => entry.id === selected);
  return (
    <View style={{ gap: 12 }}>
      <Heading>Users and access</Heading>
      <Label muted>
        New users need an explicit library, folder, or title grant.
        Administrators can access and manage the entire server.
      </Label>
      <Refresh
        onPress={() => {
          resource.retry();
          libraries.retry();
        }}
      />
      <ResourceState resource={resource} />
      <Feedback action={action} />
      {resource.value?.users.map((entry) => (
        <Button
          key={entry.id}
          label={`${entry.username} · ${entry.role}${entry.disabled ? " · Disabled" : ""}`}
          selected={selected === entry.id}
          onPress={() =>
            setSelected((previous) => (previous === entry.id ? null : entry.id))
          }
        />
      ))}
      {user && (
        <UserEditor
          key={JSON.stringify(user)}
          user={user}
          libraries={libraries.value?.libraries ?? []}
          refresh={resource.retry}
        />
      )}
      <Group title="Create user">
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <Field
          label="Initial password (12–128 characters)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <Button
          label="Create user"
          disabled={
            action.busy ||
            !username.trim() ||
            password.length < 12 ||
            password.length > 128
          }
          onPress={async () => {
            const result = await action.run<{ user: User }>(
              "/api/auth/users",
              "POST",
              { username: username.trim(), password, role: "user" },
            );
            if (result) {
              setUsername("");
              setPassword("");
              setSelected(result.user.id);
            }
          }}
        />
      </Group>
    </View>
  );
}
function UserEditor({
  user,
  libraries,
  refresh,
}: {
  user: User;
  libraries: LibraryItem[];
  refresh: () => void;
}) {
  const { api, session } = useClient();
  const resource = useResource(
    (signal) =>
      api.request<{ rules: Rule[] }>(`/api/auth/users/${user.id}/rules`, {
        signal,
      }),
    [api, user.id],
  );
  const action = useAdminAction();
  const [role, setRole] = useState(user.role);
  const [disabled, setDisabled] = useState(user.disabled);
  const [age, setAge] = useState(
    user.maxAge === null ? "" : String(user.maxAge),
  );
  const [blockUnrated, setBlockUnrated] = useState(user.blockUnrated);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [scope, setScope] = useState<Rule["scope"]>("library");
  const [target, setTarget] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const titles = useResource(
    (signal) => (query ? api.search(query, signal) : Promise.resolve(null)),
    [api, query],
  );
  const shown = rules ?? resource.value?.rules ?? [];
  const self = user.id === session.profile.userId;
  async function save() {
    const maxAge = age.trim() === "" ? null : Number(age);
    if (
      maxAge !== null &&
      (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 21)
    ) {
      action.setMessage(
        "Enter an age from 0 to 21, or leave it blank for no limit.",
      );
      return;
    }
    const updated = await action.run(
      `/api/auth/users/${user.id}`,
      "PUT",
      { role, disabled, maxAge, blockUnrated },
      "Account settings saved.",
    );
    if (!updated) return;
    if (rules !== null) {
      const result = await action.run(
        `/api/auth/users/${user.id}/rules`,
        "PUT",
        {
          rules: rules.map((rule) => ({
            ...rule,
            allowed: Boolean(rule.allowed),
          })),
        },
        "Account and access rules saved.",
      );
      if (!result) return;
    }
    refresh();
  }
  return (
    <Group title={`Edit ${user.username}`}>
      <Feedback action={action} />
      <Label>Account role</Label>
      <Button
        label="Ordinary user"
        selected={role === "user"}
        disabled={self || action.busy}
        onPress={() => setRole("user")}
      />
      <Button
        label="Administrator"
        selected={role === "admin"}
        disabled={action.busy}
        onPress={() => setRole("admin")}
      />
      <Button
        label={`Account: ${disabled ? "Disabled" : "Enabled"}`}
        disabled={self || action.busy}
        onPress={() => setDisabled(!disabled)}
      />
      {self && (
        <Label muted>
          You cannot disable or demote your own administrator account.
        </Label>
      )}
      <Field
        label="Maximum content age (blank for no limit)"
        value={age}
        onChangeText={setAge}
        keyboardType="number-pad"
      />
      <Button
        label={`Unrated content: ${blockUnrated ? "Blocked" : "Allowed"}`}
        onPress={() => setBlockUnrated(!blockUnrated)}
      />
      <Heading>Access rules</Heading>
      <ResourceState resource={resource} />
      <Label muted>
        Explicit blocks take priority over grants. Administrator accounts bypass
        content restrictions.
      </Label>
      {shown.map((rule, index) => (
        <View key={`${rule.scope}:${rule.target}:${index}`} style={{ gap: 8 }}>
          <Label>
            {rule.allowed ? "Allow" : "Block"} {rule.scope}:{" "}
            {rule.scope === "library"
              ? (libraries.find((library) => String(library.id) === rule.target)
                  ?.name ?? rule.target)
              : rule.target}
          </Label>
          <Button
            label={`Remove rule ${index + 1}`}
            disabled={action.busy}
            onPress={() => setRules(shown.filter((_, i) => i !== index))}
          />
        </View>
      ))}
      {(["library", "folder", "item"] as const).map((value) => (
        <Button
          key={value}
          label={
            value === "item"
              ? "Title rule"
              : `${value === "library" ? "Library" : "Folder"} rule`
          }
          selected={scope === value}
          onPress={() => {
            setScope(value);
            setTarget("");
          }}
        />
      ))}
      {scope === "library" ? (
        libraries.map((library) => (
          <Button
            key={library.id}
            label={library.name}
            selected={target === String(library.id)}
            onPress={() => setTarget(String(library.id))}
          />
        ))
      ) : (
        <>
          <Field
            label={
              scope === "folder" ? "Folder path on the server" : "Title ID"
            }
            value={target}
            onChangeText={setTarget}
            autoCapitalize="none"
          />
          {scope === "item" && (
            <>
              <Field
                label="Find a title"
                value={search}
                onChangeText={setSearch}
              />
              <Button
                label="Search titles"
                disabled={!search.trim()}
                onPress={() => setQuery(search.trim())}
              />
              <ResourceState resource={titles} />
              {titles.value?.titles.map((title) => (
                <Button
                  key={title.id}
                  label={title.name}
                  selected={target === String(title.id)}
                  onPress={() => setTarget(String(title.id))}
                />
              ))}
            </>
          )}
        </>
      )}
      <Button
        label={allowed ? "Grant access" : "Block access"}
        selected={allowed}
        onPress={() => setAllowed(!allowed)}
      />
      <Button
        label="Add rule"
        disabled={
          action.busy ||
          resource.loading ||
          !!resource.error ||
          !target.trim() ||
          shown.length >= 500
        }
        onPress={() => {
          const next = target.trim();
          if (scope === "item" && !/^\d+$/.test(next)) {
            action.setMessage("Choose a title or enter its numeric ID.");
            return;
          }
          setRules([
            ...shown.filter(
              (rule) => rule.scope !== scope || rule.target !== next,
            ),
            { scope, target: next, allowed },
          ]);
          setTarget("");
        }}
      />
      <Button
        label={action.busy ? "Saving…" : "Save account and access"}
        disabled={action.busy || resource.loading || !!resource.error}
        onPress={() => {
          if (
            (!user.disabled && disabled) ||
            (user.role !== "admin" && role === "admin") ||
            (user.role === "admin" && role !== "admin")
          )
            confirmAction(
              "Change account access?",
              `Update ${user.username}? Administrator access allows management of the entire server. Disabling an account signs out all its devices.`,
              () => {
                void save();
              },
            );
          else void save();
        }}
      />
    </Group>
  );
}
