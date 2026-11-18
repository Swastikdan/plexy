import { useState } from "react";
import { Text, View } from "react-native";
import { useClient } from "@/core/client/client-provider";
import {
  familyLevelDescriptions,
  familyLevelLabels,
  familyRegions,
  familyRegionLabel,
  type FamilyLevel,
} from "@/core/content/audience";
import {
  hashFamilyPin,
  verifyFamilyPin,
} from "@/core/content/family-pin";
import { useAppDialog } from "@/shared/ui/app-dialog";
import { Notice } from "@/shared/ui/notice";
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { SettingsRow } from "./settings-row";
import { PinDialog } from "./pin-dialog";

type PinRequest =
  | { mode: "set"; level: FamilyLevel }
  | { mode: "verify"; action: () => void };

export function FamilySettings() {
  const showDialog = useAppDialog();
  const { preferences, updatePreferences } = useClient();
  const [unlocked, setUnlocked] = useState(false);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);

  const withPin = (action: () => void) => {
    if (preferences.familyLevel === "off" || unlocked) {
      action();
      return;
    }
    // An install upgraded from before PINs existed has no hash yet. Set one
    // instead of leaving the mode permanently locked.
    if (!preferences.familyPinHash) {
      setPinRequest({ mode: "set", level: preferences.familyLevel });
      return;
    }
    setPinRequest({ mode: "verify", action });
  };

  const chooseLevel = (level: FamilyLevel) => {
    if (level === preferences.familyLevel) return;
    if (level === "off") {
      if (preferences.familyLevel === "off") return;
      withPin(() => updatePreferences({ familyLevel: "off" }));
      return;
    }
    if (preferences.familyLevel === "off") {
      setPinRequest({ mode: "set", level });
      return;
    }
    withPin(() => updatePreferences({ familyLevel: level }));
  };

  const openLevels = () => {
    showDialog(
      "Kids & family mode",
      "Choose the highest rating that can appear while the mode is on. Titles above it, 18+ titles and unrated titles (when blocking is on) are hidden and cannot be played.",
      [
        ...(["off", "little", "older", "teen"] as FamilyLevel[]).map((level) => ({
          text: `${preferences.familyLevel === level ? "✓ " : ""}${familyLevelLabels[level]}`,
          onPress: () => chooseLevel(level),
        })),
      ],
    );
  };

  const openRegions = () => {
    showDialog(
      "Rating system",
      "TMDB ratings are issued per country. Choose the region used for online titles in Kids & family mode.",
      familyRegions.map(([code, label]) => ({
        text: `${preferences.familyRegion === code ? "✓ " : ""}${label}`,
        onPress: () =>
          withPin(() => updatePreferences({ familyRegion: code })),
      })),
    );
  };

  return (
    <View className="gap-4">
      <Notice message="While Kids & family mode is on, Home, Search and Library hide titles above the limit. 18+ titles are always blocked, unrated titles follow the switch below, and a title link cannot open the player." />

      <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
        Maturity limit
      </Text>
      <View className="overflow-hidden rounded-[18px] bg-surface">
        <SettingsRow
          navigation
          title="Kids & family mode"
          subtitle={familyLevelLabels[preferences.familyLevel]}
          onPress={openLevels}
        />
        <SettingsRow
          title="Block unrated titles"
          subtitle="Titles with no stored age rating stay hidden"
        >
          <ToggleSwitch
            value={preferences.familyBlockUnrated}
            accessibilityLabel="Block unrated titles"
            onValueChange={(value) =>
              withPin(() => updatePreferences({ familyBlockUnrated: value }))
            }
          />
        </SettingsRow>
        <SettingsRow
          navigation
          title="Rating system"
          subtitle={familyRegionLabel(preferences.familyRegion)}
          onPress={openRegions}
        />
      </View>

      <Text className="mt-1 text-[12px] leading-[18px] font-archivo-regular text-muted">
        {familyLevelDescriptions[preferences.familyLevel]} Unrated local
        files are hidden too while blocking is on. A 4-digit PIN is required to
        turn the mode off or loosen its limit. If the PIN is forgotten,
        clearing Plexy’s app data is the only reset.
      </Text>

      <PinDialog
        visible={pinRequest != null}
        mode={pinRequest?.mode ?? "verify"}
        title={
          pinRequest?.mode === "set" ? "Set a family PIN" : "Kids mode is on"
        }
        description={
          pinRequest?.mode === "set"
            ? "This PIN will be needed to turn Kids & family mode off or change its limit."
            : "Enter the family PIN to change this setting."
        }
        onClose={() => setPinRequest(null)}
        onSubmit={async (pin) => {
          if (pinRequest?.mode === "set") {
            const hash = await hashFamilyPin(pin);
            updatePreferences({
              familyLevel: pinRequest.level,
              familyPinHash: hash,
            });
            setUnlocked(true);
            return true;
          }
          if (!pinRequest) return false;
          const valid = await verifyFamilyPin(
            pin,
            preferences.familyPinHash,
          );
          if (!valid) return false;
          setUnlocked(true);
          pinRequest.action();
          return true;
        }}
      />
    </View>
  );
}
