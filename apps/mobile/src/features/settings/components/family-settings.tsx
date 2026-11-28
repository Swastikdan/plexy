import { useState } from "react";
import { Text, View } from "react-native";
import type { Preferences } from "@/core/client/preferences";
import { useClient } from "@/core/client/client-provider";
import {
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
import { ToggleSwitch } from "@/shared/ui/toggle-switch";
import { SettingsRow } from "./settings-row";
import { PinDialog } from "./pin-dialog";

type FamilyChange = Pick<Preferences, "familyLevel" | "familyRegion" | "familyBlockUnrated">;
type PinRequest = { mode: "set" | "verify"; change: Partial<FamilyChange> };

export function FamilySettings() {
  const showDialog = useAppDialog();
  const { preferences, updatePreferences } = useClient();
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);

  const changeFamilySetting = (change: Partial<FamilyChange>) => {
    if (preferences.familyPinHash) {
      setPinRequest({ mode: "verify", change });
    } else if (preferences.familyLevel !== "off" || change.familyLevel) {
      // Older installations can have an active limit without a saved PIN.
      setPinRequest({ mode: "set", change });
    } else {
      updatePreferences(change);
    }
  };

  const chooseLevel = (level: FamilyLevel) => {
    if (level !== preferences.familyLevel) {
      changeFamilySetting({ familyLevel: level });
    }
  };

  const openLevels = () => {
    showDialog(
      "Kids & family mode",
      "Hides everything in your library above the selected rating.",
      [
        ...(["off", "little", "older", "teen"] as FamilyLevel[]).map((level) => ({
          text: familyLevelLabels[level],
          selected: preferences.familyLevel === level,
          onPress: () => chooseLevel(level),
        })),
      ],
    );
  };

  const openRegions = () => {
    showDialog(
      "Rating system",
      "Choose a country’s ratings for online titles.",
      familyRegions.map(([code, label]) => ({
        text: label,
        selected: preferences.familyRegion === code,
        onPress: () => {
          if (code !== preferences.familyRegion) changeFamilySetting({ familyRegion: code });
        },
      })),
    );
  };

  return (
    <View className="gap-3">
      <Text className="mt-3.5 ml-[2px] text-[13px] font-archivo-medium text-muted">
        Maturity limit
      </Text>
      <View className="overflow-hidden rounded-[18px] bg-surface">
        <SettingsRow
          navigation
          title="Kids & family mode"
          value={familyLevelLabels[preferences.familyLevel]}
          onPress={openLevels}
        />
        <SettingsRow
          title="Block unrated titles"
        >
          <ToggleSwitch
            value={preferences.familyBlockUnrated}
            accessibilityLabel="Block unrated titles"
            onValueChange={(value) =>
              changeFamilySetting({ familyBlockUnrated: value })
            }
          />
        </SettingsRow>
        <SettingsRow
          navigation
          title="Rating system"
          value={familyRegionLabel(preferences.familyRegion)}
          onPress={openRegions}
        />
      </View>

      <PinDialog
        visible={pinRequest != null}
        mode={pinRequest?.mode ?? "verify"}
        title={
          pinRequest?.mode === "set" ? "Set a family PIN" : "Enter family PIN"
        }
        description={
          pinRequest?.mode === "set"
            ? "Protect your family settings."
            : "Confirm this change."
        }
        onClose={() => setPinRequest(null)}
        onSubmit={async (pin) => {
          if (!pinRequest) return false;
          if (pinRequest.mode === "set") {
            updatePreferences({ ...pinRequest.change, familyPinHash: await hashFamilyPin(pin) });
            return true;
          }
          if (!(await verifyFamilyPin(pin, preferences.familyPinHash))) return false;
          updatePreferences(pinRequest.change);
          return true;
        }}
      />
    </View>
  );
}
