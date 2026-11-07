import React, { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useClient } from "../context";
import { Button, Heading, Label, Notice } from "../ui";
import { colors } from "../theme";

export function useAdminAction(refresh?: () => void) {
  const { api } = useClient();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run<T = unknown>(
    url: string,
    method = "POST",
    body?: unknown,
    success = "Server updated.",
  ): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.request<T>(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      refresh?.();
      setMessage(success);
      return result;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The server could not complete this action. Try again.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, message, setMessage, run };
}
export function confirmAction(title: string, detail: string, run: () => void) {
  Alert.alert(title, detail, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", style: "destructive", onPress: run },
  ]);
}
export function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        gap: 12,
        paddingVertical: 16,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      <Heading>{title}</Heading>
      {children}
    </View>
  );
}
export function Feedback({
  action,
}: {
  action: ReturnType<typeof useAdminAction>;
}) {
  return action.message ? <Notice message={action.message} /> : null;
}
export function ResourceState({
  resource,
  empty,
}: {
  resource: { loading: boolean; error: string | null; retry: () => void };
  empty?: string;
}) {
  return (
    <>
      {resource.loading && <Label muted>Loading…</Label>}
      {resource.error && (
        <Notice message={resource.error} retry={resource.retry} />
      )}
      {!resource.loading && !resource.error && empty && (
        <Label muted>{empty}</Label>
      )}
    </>
  );
}
export function Refresh({ onPress }: { onPress: () => void }) {
  return <Button label="Refresh" onPress={onPress} />;
}
