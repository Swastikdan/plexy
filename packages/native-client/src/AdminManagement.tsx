import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useClient } from "./context";
import { useResource } from "./hooks";
import { Button, Field, Heading, Label, Notice } from "./ui";
import type { LibraryItem } from "../../api-client/src/types";

type User = { id: number; username: string; role: "admin" | "user"; disabled: boolean; maxAge: number | null; blockUnrated: boolean };
export function AdminManagement() {
  const { api, session } = useClient();
  const libraries = useResource(() => api.request<{ libraries: LibraryItem[] }>("/api/libraries"), [api]);
  const users = useResource(() => api.request<{ users: User[] }>("/api/auth/users"), [api]);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<"movies" | "tv" | "anime">("movies");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(url: string, method = "POST", body?: unknown) {
    setBusy(true); setMessage("");
    try {
      await api.request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      libraries.retry(); users.retry(); setMessage("Server updated.");
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); return false; }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <Heading>Libraries</Heading>
    {libraries.error && <Notice message={libraries.error} retry={libraries.retry} />}
    {libraries.value?.libraries.map(library => <View key={library.id} style={{ gap: 8 }}>
      <Label>{library.name} · {library.type}</Label>
      <Label muted>{library.paths.join("\n")}</Label>
      <Button label={`Scan ${library.name}`} disabled={busy} onPress={() => action(`/api/libraries/${library.id}/scan`)} />
      <Button label={`Remove ${library.name}`} disabled={busy} onPress={() => Alert.alert("Remove library?", "This removes the library from Plexy. Media files stay on the server.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => action(`/api/libraries/${library.id}`, "DELETE") }])} />
    </View>)}
    <Field label="New library name" value={name} onChangeText={setName} />
    <Field label="Folder path on the server" value={path} onChangeText={setPath} />
    {(["movies", "tv", "anime"] as const).map(value => <Button key={value} label={value} selected={kind === value} onPress={() => setKind(value)} />)}
    <Button label="Add library" disabled={busy || !name.trim() || !path.trim()} onPress={async () => { if (await action("/api/libraries", "POST", { name: name.trim(), type: kind, paths: [path.trim()] })) { setName(""); setPath(""); } }} />
    <Heading>Users</Heading>
    {users.error && <Notice message={users.error} retry={users.retry} />}
    {users.value?.users.map(user => <View key={user.id} style={{ gap: 8 }}>
      <Label>{user.username} · {user.role}{user.disabled ? " · Disabled" : ""}</Label>
      {user.id !== session.profile.userId && <>
        <Button label={user.disabled ? "Enable account" : "Disable account"} disabled={busy} onPress={() => Alert.alert("Change account access?", `Update access for ${user.username}?`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => action(`/api/auth/users/${user.id}`, "PUT", { role: user.role, disabled: !user.disabled, maxAge: user.maxAge, blockUnrated: user.blockUnrated }) }])} />
        <Button label={user.role === "admin" ? "Make ordinary user" : "Make administrator"} disabled={busy} onPress={() => Alert.alert("Change administrator access?", `Update the role for ${user.username}? Administrators can manage the entire server.`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => action(`/api/auth/users/${user.id}`, "PUT", { role: user.role === "admin" ? "user" : "admin", disabled: user.disabled, maxAge: user.maxAge, blockUnrated: user.blockUnrated }) }])} />
      </>}
    </View>)}
    <Field label="New username" value={username} onChangeText={setUsername} />
    <Field label="New user password" value={password} onChangeText={setPassword} secureTextEntry />
    <Button label="Create user" disabled={busy || !username.trim() || !password} onPress={async () => { if (await action("/api/auth/users", "POST", { username: username.trim(), password, role: "user" })) { setUsername(""); setPassword(""); } }} />
    <Heading>Maintenance</Heading>
    {[["/api/optimize/run", "Prepare optimized media"], ["/api/skip-segments/refresh", "Refresh intro and credits markers"], ["/api/tmdb/cache/clear", "Clear metadata response cache"]].map(([url, label]) => <Button key={url} label={label} disabled={busy} onPress={() => action(url)} />)}
    {!!message && <Notice message={message} />}
  </View>;
}
