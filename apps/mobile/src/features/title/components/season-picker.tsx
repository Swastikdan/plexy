import { Menu } from "heroui-native/menu";
import { ScrollView, Text, View } from "react-native";
import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import {
  Eye,
  EyeOff,
  ChevronDown,
  MoreHorizontal,
  ArrowUpDown,
  Check,
} from "@/shared/ui/icons";

export function SeasonPicker({
  seasons,
  value,
  onChange,
  onMarkWatched,
  busy = false,
  watched = false,
  sort,
  onSortChange,
}: {
  sort?: "oldest" | "newest";
  onSortChange?: (sort: "oldest" | "newest") => void;
  seasons: { number: number; label: string; count?: number }[];
  value: number | null;
  onChange: (season: number) => void;
  onMarkWatched: () => void;
  busy?: boolean;
  watched?: boolean;
}) {
  const colors = useColors();
  if (!seasons.length) return null;
  const active =
    seasons.find((season) => season.number === value) ?? seasons[0]!;
  return (
    <View className="w-full gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Menu>
          <Menu.Trigger
            accessibilityLabel={active.count == null
              ? `Season selector, ${active.label}`
              : `Season selector, ${active.label}, ${active.count} episodes`}
            hitSlop={6}
            className="min-h-11 shrink flex-row items-center gap-2 active:opacity-70"
          >
            <Text numberOfLines={1} className="shrink font-archivo-bold text-[17px] text-foreground">
              {active.label}
            </Text>
            <Text className="font-archivo-medium text-[15px] text-muted">
              {active.count == null ? "—" : `(${active.count})`}
            </Text>
            <ChevronDown size={20} color={colors.ink} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Overlay />
            <Menu.Content presentation="popover" align="start" offset={6} width={244}
              className="border border-border bg-surface-secondary">
              <ScrollView style={{ maxHeight: 300 }}>
                {seasons.map((season) => {
                  const selected = season.number === active.number;
                  return (
                    <Menu.Item key={season.number} className={selected ? "min-h-12 bg-foreground/[0.08]" : "min-h-12"}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        triggerHaptic("selection");
                        if (!selected) onChange(season.number);
                      }}>
                      <Menu.ItemTitle className={selected ? "font-archivo-bold" : "font-archivo-medium"}>{season.label}</Menu.ItemTitle>
                      {season.count != null ? (
                        <Text className="text-muted">({season.count})</Text>
                      ) : null}
                    </Menu.Item>
                  );
                })}
              </ScrollView>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
        <View className="flex-row items-center gap-2">
        {sort && onSortChange ? (
          <Menu>
            <Menu.Trigger
              accessibilityLabel={`Sort episodes, ${sort === "oldest" ? "oldest first" : "newest first"}`}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
            >
              <ArrowUpDown size={19} color={colors.ink} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Overlay />
              <Menu.Content presentation="popover" align="end" offset={6} width={184} className="border border-border bg-surface-secondary">
                {(["oldest", "newest"] as const).map((order) => (
                  <Menu.Item key={order} accessibilityState={{ selected: sort === order }}
                    onPress={() => {
                      triggerHaptic("selection");
                      onSortChange(order);
                    }}
                    className="min-h-12">
                    <Menu.ItemTitle className={sort === order ? "font-archivo-bold" : "font-archivo-medium"}>
                      {order === "oldest" ? "Oldest first" : "Newest first"}
                    </Menu.ItemTitle>
                    {sort === order ? <Check size={18} color={colors.ink} /> : null}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        ) : null}
        <Menu>
          <Menu.Trigger
            accessibilityLabel="Season actions"
            isDisabled={busy}
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-full border border-border bg-surface"
          >
            <MoreHorizontal size={22} color={colors.ink} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Overlay />
            <Menu.Content presentation="popover" align="end" offset={6} width={208} className="border border-border bg-surface-secondary">
              <Menu.Item onPress={onMarkWatched} className="min-h-12">
                {watched ? <EyeOff size={18} color={colors.ink} /> : <Eye size={18} color={colors.ink} />}
                <Menu.ItemTitle className="font-archivo-medium">{watched ? "Mark as unwatched" : "Mark as watched"}</Menu.ItemTitle>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
        </View>
      </View>

    </View>
  );
}
