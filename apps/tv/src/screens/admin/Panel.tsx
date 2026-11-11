import React, { useState } from "react";
import { View } from "react-native";
import { Button, Heading, Label } from "../../components/ui";
import { AdminSettings } from "../AdminSettings";
import { AdminLibraries } from "./Libraries";
import { AdminUsers } from "./Users";
import { AdminDevices } from "./Devices";
import { AdminMatches } from "./Matches";
import { AdminMaintenance } from "./Maintenance";
import { AdminLogs } from "./Logs";
import { confirmAction } from "./shared";

const sections = [
  ["settings", "Server preferences"],
  ["libraries", "Libraries and scans"],
  ["users", "Users and access"],
  ["devices", "All signed-in devices"],
  ["matches", "Fix matches"],
  ["maintenance", "Status and maintenance"],
  ["logs", "Logs and crash reports"],
] as const;
type Section = (typeof sections)[number][0];
export function AdminPanel() {
  const [section, setSection] = useState<Section | null>(null);
  const [dirty, setDirty] = useState(false);
  function open(next: Section | null) {
    const change = () => {
      setDirty(false);
      setSection(next);
    };
    if (dirty)
      confirmAction(
        "Discard unsaved changes?",
        "Your unsaved server preferences will be lost.",
        change,
      );
    else change();
  }
  return (
    <View style={{ gap: 12 }}>
      <Heading>Server administration</Heading>
      <Label muted>
        Administrator controls affect everyone on this server.
      </Label>
      {sections.map(([key, label]) => (
        <Button
          key={key}
          label={label}
          selected={section === key}
          onPress={() => open(section === key ? null : key)}
        />
      ))}
      {section && (
        <>
          <Button
            label="Close administration section"
            onPress={() => open(null)}
          />
          {section === "settings" && <AdminSettings dirtyChanged={setDirty} />}
          {section === "libraries" && <AdminLibraries />}
          {section === "users" && <AdminUsers />}
          {section === "devices" && <AdminDevices />}
          {section === "matches" && <AdminMatches />}
          {section === "maintenance" && <AdminMaintenance />}
          {section === "logs" && <AdminLogs />}
        </>
      )}
    </View>
  );
}
