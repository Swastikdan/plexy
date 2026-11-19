import { useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import { applicationId } from "expo-application";
import { startActivityAsync } from "expo-intent-launcher";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { PageHeader } from "@/shared/ui/page-header";
import { ChevronDown } from "@/shared/ui/icons";
import { Notice } from "@/shared/ui/notice";
import { SettingsRow } from "./components/settings-row";
import licenses from "./data/open-source-licenses.json";

type License = (typeof licenses)[number];

const licenseTypeCount = new Set(licenses.map(entry => entry.license)).size;

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function OpenSourceScreen() {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<License | null>(null);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const [licenseTextOpen, setLicenseTextOpen] = useState(false);
  const [error, setError] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery
        ? licenses.filter(entry =>
            `${entry.name} ${entry.version} ${entry.license}`
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : licenses,
    [normalizedQuery],
  );
  const sections = useMemo(() => {
    const grouped = new Map<string, License[]>();
    for (const entry of filtered) {
      const key = entry.license || "See notices";
      const group = grouped.get(key);
      if (group) group.push(entry);
      else grouped.set(key, [entry]);
    }
    return [...grouped.entries()]
      .map(([title, data]) => ({ title, count: data.length, data }))
      .sort(
        (a, b) => b.count - a.count || a.title.localeCompare(b.title),
      );
  }, [filtered]);
  // Searching ignores the accordion so every match is visible at once.
  const visibleSections = useMemo(
    () =>
      normalizedQuery
        ? sections
        : sections.map(section =>
            section.title === expandedLicense
              ? section
              : { ...section, data: [] as License[] },
          ),
    [expandedLicense, normalizedQuery, sections],
  );
  useEffect(() => {
    if (!selected) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setSelected(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [selected]);
  const openUrl = (url: string) => {
    setError("");
    void Linking.openURL(url).catch(() =>
      setError("Could not open the project website."),
    );
  };
  const openNativeNotices = async () => {
    try {
      setError("");
      await startActivityAsync("android.intent.action.VIEW", {
        packageName: applicationId ?? "app.plexy.mobile",
        className: "com.google.android.gms.oss.licenses.v2.OssLicensesMenuActivity",
      });
    } catch {
      setError(
        "Android library licenses require a new native build of Plexy. Update the app to view them.",
      );
    }
  };
  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title={selected ? selected.name : "Open Source Licenses"}
        subtitle={
          selected
            ? `${selected.version} · ${selected.license}`
            : `${countLabel(licenses.length, "package")} · ${countLabel(licenseTypeCount, "license type")}`
        }
        onBack={selected ? () => setSelected(null) : undefined}
      />
      {selected ? (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
        >
          <View className="overflow-hidden rounded-[18px] bg-surface">
            <SettingsRow
              title="Project website"
              subtitle={selected.url.replace(/^https?:\/\//, "")}
              navigation
              onPress={() => openUrl(selected.url)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="License text"
              accessibilityState={{ expanded: licenseTextOpen }}
              onPress={() => {
                triggerHaptic("light");
                setLicenseTextOpen(open => !open);
              }}
              className="min-h-[66px] flex-row items-center gap-3.5 px-4 py-3.5 active:bg-surface-hover"
            >
              <View className="flex-1 gap-1">
                <Text className="text-[15px] font-archivo-medium text-foreground">
                  License text
                </Text>
                <Text className="text-[12px] leading-[18px] font-archivo-regular text-muted">
                  Included for offline reading ·{" "}
                  {countLabel(selected.notices.length, "file")}
                </Text>
              </View>
              <ChevronDown
                size={20}
                color={colors.muted}
                style={{
                  transform: [
                    { rotate: licenseTextOpen ? "180deg" : "0deg" },
                  ],
                }}
              />
            </Pressable>
          </View>
          {selected.modifications ? (
            <Notice message={selected.modifications} />
          ) : null}
          {licenseTextOpen
            ? selected.notices.map((notice, index) => (
                <View
                  key={`${notice.file}-${index}`}
                  className="gap-3 rounded-[18px] bg-surface p-4"
                >
                  <Text className="font-archivo-bold text-[13px] text-muted">
                    {notice.file}
                  </Text>
                  <Text
                    selectable
                    className="text-[13px] leading-[20px] text-foreground"
                  >
                    {notice.text}
                  </Text>
                </View>
              ))
            : null}
          {error ? <Notice message={error} /> : null}
        </ScrollView>
      ) : (
        <SectionList
          sections={visibleSections}
          keyExtractor={entry => `${entry.name}@${entry.version}`}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            <View className="gap-4 px-5 pb-2">
              {Platform.OS === "android" ? (
                <View className="overflow-hidden rounded-[18px] bg-surface">
                  <SettingsRow
                    title="Android library licenses"
                    subtitle="Native playback and platform libraries"
                    navigation
                    onPress={() => void openNativeNotices()}
                  />
                </View>
              ) : null}
              {error ? <Notice message={error} /> : null}
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${licenses.length} packages or licenses`}
                placeholderTextColor={colors.muted}
                accessibilityLabel="Search open source licenses"
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-12 rounded-xl bg-surface px-4 text-[15px] text-foreground"
              />
              <Text className="text-[13px] leading-[19px] text-muted">
                {normalizedQuery
                  ? `${countLabel(filtered.length, "package")} ${filtered.length === 1 ? "matches" : "match"}`
                  : "Grouped by license. Tap a license to see its packages."}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text className="px-5 text-muted">No matching projects.</Text>
          }
          renderSectionHeader={({ section }) => {
            const expanded =
              normalizedQuery.length > 0 ||
              expandedLicense === section.title;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${section.title}, ${countLabel(section.count, "package")}`}
                accessibilityState={{ expanded }}
                disabled={normalizedQuery.length > 0}
                onPress={() => {
                  triggerHaptic("light");
                  setExpandedLicense(current =>
                    current === section.title ? null : section.title,
                  );
                }}
                className="flex-row items-center gap-3 bg-background px-5 py-3 active:opacity-70"
              >
                <Text
                  numberOfLines={1}
                  className="flex-1 font-archivo-bold text-[13px] uppercase tracking-[0.4px] text-muted"
                >
                  {section.title}
                </Text>
                <Text className="text-[13px] font-archivo-medium text-muted">
                  {section.count}
                </Text>
                <ChevronDown
                  size={16}
                  color={colors.muted}
                  style={{
                    transform: [{ rotate: expanded ? "180deg" : "0deg" }],
                  }}
                />
              </Pressable>
            );
          }}
          renderItem={({ item }) => (
            <SettingsRow
              title={item.name}
              subtitle={item.version}
              navigation
              onPress={() => {
                setError("");
                setLicenseTextOpen(false);
                setSelected(item);
              }}
            />
          )}
        />
      )}
    </View>
  );
}
