import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useClient } from "@/core/client/client-provider";
import { useColors } from "@/shared/theme";
import { Button } from "@/shared/ui/button";
import { Notice } from "@/shared/ui/notice";
import { X } from "@/shared/ui/icons";
import { useMovy, type DownloadMeta } from "../movy-provider";
import { heightOf, pickQuality, sortQualities } from "../lib/quality";
import { localCopy } from "../lib/library-import";
import type { MovyDownloadOptions } from "../lib/api";
import type { MovyQualityOption, MovyTitleRef } from "../lib/types";

export interface DownloadTarget {
  ref: MovyTitleRef;
  meta: DownloadMeta;
}

export function QualitySheet({
  visible,
  target,
  onClose,
  onAccount,
}: {
  visible: boolean;
  target: DownloadTarget | null;
  onClose: () => void;
  onAccount: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { preferences } = useClient();
  const movy = useMovy();
  const [options, setOptions] = useState<MovyQualityOption[]>([]);
  const [quota, setQuota] = useState<MovyDownloadOptions["quota"] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadOptions = movy.loadOptions;

  useEffect(() => {
    if (!visible || !target) return;
    let live = true;
    void loadOptions(target.ref)
      .then((reply) => {
        if (!live) return;
        const sorted = sortQualities(reply.options);
        const chosen = pickQuality(reply.options, preferences.movyMaxHeight);
        setOptions(sorted);
        setQuota(reply.quota);
        setSelected(chosen?.option.quality ?? sorted[0]?.quality ?? null);
        if (!sorted.length) {
          setError("No source is available for this title.");
        }
      })
      .catch((cause) => {
        if (!live) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load download options.",
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [visible, target, preferences.movyMaxHeight, loadOptions]);

  const selectedOption = useMemo(
    () => options.find((option) => option.quality === selected) ?? null,
    [options, selected],
  );
  const alreadyLocal = target
    ? localCopy({
        tmdbId: target.ref.tmdbId,
        mediaType: target.ref.mediaType,
        season: target.ref.season ?? null,
        episode: target.ref.episode ?? null,
      })
    : null;
  const usedUp = Boolean(quota && quota.limit > 0 && quota.remaining <= 0);
  const canRotate =
    usedUp &&
    (movy.accounts.some(
      (account) =>
        account.username !== movy.active?.username &&
        (account.quota == null || account.quota.remaining > 0),
    ) ||
      preferences.movyAutoCreateAccount);

  const start = async () => {
    if (!target || !selectedOption) return;
    setBusy(true);
    setError(null);
    try {
      await movy.download(target.ref, selectedOption, target.meta);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start the download.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View
          className="max-h-[86%] rounded-t-[24px] bg-overlay pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, 18) }}
        >
          <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3">
            <View className="flex-1">
              <Text className="font-archivo-bold text-[20px] text-foreground">
                Download quality
              </Text>
              {target ? (
                <Text
                  numberOfLines={1}
                  className="mt-0.5 font-archivo-regular text-[12px] text-muted"
                >
                  {target.meta.display}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface"
            >
              <X size={20} color={colors.ink} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 10, gap: 12 }}
          >
            {error ? <Notice kind="error" message={error} /> : null}
            {alreadyLocal ? (
              <Notice message="This title is already in your library." />
            ) : null}

            {loading ? (
              <View className="items-center py-8">
                <ActivityIndicator color={colors.muted} />
              </View>
            ) : null}

            {!loading && options.length > 0 ? (
              <View className="overflow-hidden rounded-[16px] bg-surface">
                {options.map((option) => {
                  const active = option.quality === selected;
                  const height = heightOf(option.quality);
                  return (
                    <Pressable
                      key={option.quality}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      onPress={() => setSelected(option.quality)}
                      className="min-h-[62px] flex-row items-center gap-3 border-b-[0.33px] border-border px-4 py-3 active:bg-surface-hover"
                    >
                      <View
                        className="h-[18px] w-[18px] items-center justify-center rounded-full border"
                        style={{
                          borderColor: active ? colors.ink : colors.line,
                        }}
                      >
                        {active ? (
                          <View
                            className="h-[10px] w-[10px] rounded-full"
                            style={{ backgroundColor: colors.ink }}
                          />
                        ) : null}
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Text className="font-archivo-medium text-[14px] text-foreground">
                          {height ? `${height}p` : "Source"}
                        </Text>
                        <Text
                          numberOfLines={1}
                          className="font-archivo-regular text-[11px] text-muted"
                        >
                          {option.quality}
                        </Text>
                      </View>
                      {option.size ? (
                        <Text className="font-archivo-medium text-[12px] text-muted">
                          {option.size}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {quota ? (
              <Text className="font-archivo-regular text-[12px] text-muted">
                {quota.limit > 0
                  ? `${quota.remaining} of ${quota.limit} downloads left${
                      quota.resetAt
                        ? ` · resets ${new Date(quota.resetAt).toLocaleDateString()}`
                        : " · no reset time published"
                    }`
                  : "Download quota is unavailable right now."}
              </Text>
            ) : null}
          </ScrollView>

          <View className="gap-2 px-5 pt-2">
            <Button
              label={
                busy
                  ? "Starting…"
                  : alreadyLocal
                    ? "Already in library"
                    : usedUp && !canRotate
                      ? "No downloads left"
                      : usedUp
                        ? "Use next account"
                        : "Download"
              }
              primary
              disabled={
                busy ||
                loading ||
                (usedUp && !canRotate) ||
                !selectedOption ||
                Boolean(alreadyLocal)
              }
              onPress={() => void start()}
            />
            <Button label="Manage download accounts" onPress={onAccount} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
