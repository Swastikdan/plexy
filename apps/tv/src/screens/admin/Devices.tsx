import React from "react";
import { View } from "react-native";
import { useClient } from "../../../../../packages/native-client/src/context";
import { useResource } from "../../../../../packages/native-client/src/hooks";
import { Button, Heading, Label } from "../../components/ui";
import {
  confirmAction,
  Feedback,
  Group,
  Refresh,
  ResourceState,
  useAdminAction,
} from "./shared";

type Device = {
  id: number;
  userId: number;
  username: string;
  name: string;
  revoked: boolean;
  createdAt: string;
  lastSeen: string | null;
  lastIp: string | null;
};
export function AdminDevices() {
  const { api } = useClient();
  const resource = useResource(
    (signal) =>
      api.request<{ devices: Device[] }>("/api/auth/admin/devices", { signal }),
    [api],
  );
  const action = useAdminAction(resource.retry);
  return (
    <View style={{ gap: 12 }}>
      <Heading>All signed-in devices</Heading>
      <Label muted>
        Manage devices across every account. Revoking a device signs it out
        immediately, including this device if selected.
      </Label>
      <Refresh onPress={resource.retry} />
      <ResourceState
        resource={resource}
        empty={
          resource.value?.devices.length === 0
            ? "No devices registered."
            : undefined
        }
      />
      <Feedback action={action} />
      {resource.value?.devices.map((device) => (
        <Group key={device.id} title={device.name}>
          <Label>
            {device.username} · {device.revoked ? "Revoked" : "Not revoked"}
          </Label>
          <Label muted>Added: {device.createdAt}</Label>
          <Label muted>
            Last seen: {device.lastSeen ?? "Not yet recorded"}
          </Label>
          {device.lastIp && <Label muted>Address: {device.lastIp}</Label>}
          <Button
            disabled={action.busy}
            label={device.revoked ? "Delete device record" : "Revoke device"}
            onPress={() =>
              confirmAction(
                device.revoked
                  ? "Delete device record?"
                  : "Sign this device out?",
                `${device.name} belongs to ${device.username}.`,
                () => {
                  void action.run(
                    `/api/auth/admin/devices/${device.id}${device.revoked ? "" : "/revoke"}`,
                    device.revoked ? "DELETE" : "POST",
                  );
                },
              )
            }
          />
        </Group>
      ))}
    </View>
  );
}
