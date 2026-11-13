import { triggerHaptic } from "@/shared/lib/haptics";
import { useColors } from "@/shared/theme";
import { X, Check } from "@/shared/ui/icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import type { FitMode } from "../hooks/use-player-gestures";
import type { PlayerMenu } from "../hooks/use-player-controls";
import { useClient } from "@/core/client/client-provider";
import type { ItemCard, Playability } from "@/core/library/catalog-api";
import { cn } from "@/shared/lib/cn";
import { timeLabel, easings } from "@/shared/theme";
import { Film, Minus, Plus } from "@/shared/ui/icons";
import { PosterImage } from "@/shared/ui/poster-image";
import { SheetChips, SheetSection } from "./player-sheet";

interface PlayerDrawerProps {
  menu: PlayerMenu;
  setMenu: React.Dispatch<React.SetStateAction<PlayerMenu>>;
  sortedEpisodes: ItemCard[];
  reveal: () => void;
  insets: EdgeInsets;
  manifest: Playability;
  next: (id: number) => void;
  picture: {
    fitMode: FitMode;
    applyFit: (mode: FitMode, scale: number) => void;
    zoom: number;
    startPictureInPicture: () => void;
  };
  subtitles: { position: number; setPosition: (position: number) => void };
  setPlaybackRate: (rate: number) => void;
}

export function PlayerDrawer({
  menu,
  setMenu,
  sortedEpisodes,
  reveal,
  insets,
  manifest,
  next,
  picture,
  subtitles,
  setPlaybackRate,
}: PlayerDrawerProps) {
  const colors = useColors();
  const close = () => {
    triggerHaptic("light");
    setMenu(null);
    reveal();
  };
  const { api, preferences, updatePreferences, progress } = useClient();
  const { position: subVertical, setPosition: setSubVertical } = subtitles;
  const reduceMotion = useReducedMotion();
  const [renderedMenu, setRenderedMenu] = useState(menu);
  const drawerAnim = useRef(new Animated.Value(560)).current;
  useEffect(() => {
    drawerAnim.stopAnimation();
    if (menu != null) {
      setRenderedMenu(menu);
      if (reduceMotion) {
        Animated.timing(drawerAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }).start();
      } else {
        Animated.spring(drawerAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 32,
          stiffness: 320,
          mass: 1,
        }).start();
      }
    } else {
      Animated.timing(drawerAnim, {
        toValue: 560,
        duration: reduceMotion ? 0 : 180,
        easing: easings.out,
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setRenderedMenu(null); });
    }
    return () => drawerAnim.stopAnimation();
  }, [menu, reduceMotion]);
  const episodesScrollRef = useRef<ScrollView>(null);
  const [drawerWatchedOverride, setDrawerWatchedOverride] = useState<
    Record<number, boolean>
  >({});
  const toggleDrawerEpWatched = useCallback(
    async (ep: ItemCard) => {
      triggerHaptic("selection");
      const isPlayed =
        drawerWatchedOverride[ep.id] ??
        (progress.latest(ep.id)?.played || Boolean(ep.watch?.played));
      const nextPlayed = !isPlayed;
      setDrawerWatchedOverride((prev) => ({ ...prev, [ep.id]: nextPlayed }));
      try {
        if (nextPlayed) {
          const dur = ep.runtime ? ep.runtime * 60 : ep.watch?.duration || 3600;
          await progress.record({
            itemId: ep.id,
            position: dur,
            duration: dur,
            played: true,
            updatedAt: Date.now(),
          });
        } else {
          await progress.forget(ep.id);
        }
        await api.watched(ep.id, nextPlayed);
      } catch {}
    },
    [api, progress, drawerWatchedOverride],
  );
  return (
    <Modal
      visible={renderedMenu != null}
      transparent
      animationType="none"
      onRequestClose={close}
      supportedOrientations={["landscape"]}
    >
      <View className="flex-1 flex-row justify-end bg-black/60">
        <Pressable
          className="absolute inset-0"
          focusable={false}
          onPress={close}
        />
        <Animated.View
          className="h-full w-[46%] min-w-[380px] max-w-[560px] border-l border-foreground/10 bg-overlay"
          style={{
            transform: [{ translateX: drawerAnim }],
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 20,
          }}
        >
          <View className="flex-1">
            <View className="flex-row items-center justify-between border-b-[0.33px] border-border px-5 py-3.5">
              <Text className="text-foreground text-[17px] font-bold">
                {renderedMenu === "quality"
                  ? "Video quality"
                  : renderedMenu === "episodes"
                    ? `Episodes (${sortedEpisodes.length})`
                    : "Player settings"}
              </Text>
              <Pressable
                focusable={true}
                onPress={close}
                hitSlop={8}
                className="h-12 w-12 rounded-full bg-foreground/[0.12] items-center justify-center active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel="Close menu"
              >
                <X strokeWidth={2.2} size={18} color={colors.ink} />
              </Pressable>
            </View>
            {renderedMenu === "episodes" && (
              <ScrollView
                ref={episodesScrollRef}
                contentContainerStyle={{
                  paddingBottom: Math.max(insets.bottom, 24),
                }}
                showsVerticalScrollIndicator={true}
              >
                {sortedEpisodes.map((ep, idx) => {
                  const isCurrent =
                    ep.fileId === manifest.fileId ||
                    ep.id === manifest.itemId ||
                    (ep.seasonNumber === manifest.seasonNumber &&
                      ep.episodeNumber === manifest.episodeNumber);
                  const isEpWatched =
                    drawerWatchedOverride[ep.id] ??
                    (progress.latest(ep.id)?.played ||
                      Boolean(ep.watch?.played));
                  const epLabel =
                    ep.seasonNumber != null && ep.episodeNumber != null
                      ? `S${ep.seasonNumber} · E${ep.episodeNumber}`
                      : `Episode ${ep.episodeNumber ?? idx + 1}`;
                  return (
                    <Pressable
                      key={ep.id || `${ep.seasonNumber}-${ep.episodeNumber}`}
                      onLayout={
                        isCurrent
                          ? (event) => {
                              episodesScrollRef.current?.scrollTo({
                                y: event.nativeEvent.layout.y,
                                animated: false,
                              });
                            }
                          : undefined
                      }
                      onPress={() => {
                        if (ep.fileId) {
                          setMenu(null);
                          next(ep.fileId);
                        }
                      }}
                      className={cn(
                        "flex-row items-center px-5 py-3 border-b-[0.33px] border-border active:opacity-[0.75]",
                        isCurrent &&
                          "bg-foreground/[0.08] border-l-[3px] border-l-white",
                      )}
                      accessibilityRole="button"
                      accessibilityLabel={`${epLabel}, ${ep.name}${isCurrent ? ", currently playing" : ""}`}
                    >
                      <View className="mr-3 h-[50px] w-[88px] overflow-hidden rounded-[6px] bg-foreground/[0.06]">
                        {ep.still || ep.backdrop || ep.poster ? (
                          <PosterImage
                            source={api.image(
                              ep.still || ep.backdrop || ep.poster,
                            )}
                            style={{ width: 88, height: 50, borderRadius: 6 }}
                          />
                        ) : (
                          <View className="h-[50px] w-[88px] items-center justify-center bg-foreground/[0.05]">
                            <Film size={18} color={colors.muted} />
                          </View>
                        )}
                      </View>
                      <View className="flex-1 gap-[3px]">
                        <View className="flex-row items-center gap-2">
                          <Text
                            className={cn(
                              "text-[12px] font-bold tracking-[0.5px]",
                              isCurrent ? "text-foreground" : "text-foreground/60",
                            )}
                          >
                            {epLabel}
                          </Text>
                          {isCurrent && (
                            <View className="bg-foreground rounded-[4px] px-1.5 py-0.5">
                              <Text className="text-background text-[9px] font-archivo-bold tracking-[0.5px]">
                                NOW PLAYING
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          className={cn(
                            "text-[14px]",
                            isCurrent
                              ? "text-foreground font-bold"
                              : "text-foreground/90 font-semibold",
                          )}
                          numberOfLines={2}
                        >
                          {ep.name || `Episode ${ep.episodeNumber ?? idx + 1}`}
                        </Text>
                        {ep.watch?.duration ? (
                          <Text className="text-foreground/40 text-[12px]">
                            {timeLabel(ep.watch.duration)}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => void toggleDrawerEpWatched(ep)}
                        hitSlop={10}
                        className={cn(
                          "ml-2 h-12 w-12 rounded-full items-center justify-center active:opacity-60",
                          isEpWatched
                            ? "bg-accent/20"
                            : "bg-foreground/[0.08]",
                        )}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isEpWatched ? "Mark unwatched" : "Mark watched"
                        }
                      >
                        <Check
                          strokeWidth={2.5}
                          size={16}
                          color={
                            isEpWatched ? colors.brand : colors.muted
                          }
                        />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {menu !== "episodes" && (
              <ScrollView
                contentContainerStyle={{
                  paddingBottom: Math.max(insets.bottom, 20),
                }}
                showsVerticalScrollIndicator={false}
              >
                {renderedMenu === "settings" && (
                  <>
                    <SheetSection label="Playback" />
                    <SheetChips
                      label="Speed"
                      options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
                        key: String(rate),
                        label: `${rate}×`,
                        active: preferences.playbackRate === rate,
                        onPress: () => {
                          setPlaybackRate(rate);
                        },
                      }))}
                    />

                    <>
                      <SheetSection label="Subtitles" />
                      <SheetChips
                        label={
                          preferences.subtitleOffset === 0
                            ? "Timing"
                            : `Timing ${preferences.subtitleOffset > 0 ? "+" : ""}${preferences.subtitleOffset.toFixed(1)}s`
                        }
                        options={[
                          {
                            key: "earlier",
                            label: "−0.5s",
                            onPress: () =>
                              updatePreferences({
                                subtitleOffset:
                                  preferences.subtitleOffset - 0.5,
                              }),
                          },
                          {
                            key: "reset",
                            label: "Reset",
                            active: preferences.subtitleOffset === 0,
                            onPress: () =>
                              updatePreferences({ subtitleOffset: 0 }),
                          },
                          {
                            key: "later",
                            label: "+0.5s",
                            onPress: () =>
                              updatePreferences({
                                subtitleOffset:
                                  preferences.subtitleOffset + 0.5,
                              }),
                          },
                        ]}
                      />
                      <SheetChips
                        label="Size"
                        options={[18, 22, 28, 34].map((size) => ({
                          key: String(size),
                          label: `${size}`,
                          active: preferences.subtitleSize === size,
                          onPress: () =>
                            updatePreferences({ subtitleSize: size }),
                        }))}
                      />
                      <View className="flex-row items-center justify-between px-5 pt-[18px]">
                        <View>
                          <Text className="text-foreground text-[14px] font-semibold">
                            Position
                          </Text>
                          <Text className="text-foreground text-[18px] font-bold mt-1">
                            {subVertical}%
                          </Text>
                        </View>
                        <View className="flex-row gap-2">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Move subtitles higher"
                            onPress={() => {
                              triggerHaptic("selection");
                              const nextVal = Math.max(8, subVertical - 6);
                              setSubVertical(nextVal);
                              updatePreferences({
                                subtitlePosition:
                                  nextVal < 50 ? "top" : "bottom",
                              });
                            }}
                            className="w-12 h-12 rounded-full bg-foreground/10 items-center justify-center active:opacity-60"
                          >
                            <Minus
                              size={18}
                              color={colors.ink}
                              strokeWidth={2.4}
                            />
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Move subtitles lower"
                            onPress={() => {
                              triggerHaptic("selection");
                              const nextVal = Math.min(92, subVertical + 6);
                              setSubVertical(nextVal);
                              updatePreferences({
                                subtitlePosition:
                                  nextVal < 50 ? "top" : "bottom",
                              });
                            }}
                            className="w-12 h-12 rounded-full bg-foreground/10 items-center justify-center active:opacity-60"
                          >
                            <Plus size={18} color={colors.ink} strokeWidth={2.4} />
                          </Pressable>
                        </View>
                      </View>
                      <SheetChips
                        label="Placement"
                        options={[
                          {
                            key: "top",
                            label: "Top",
                            active: subVertical === 12,
                            onPress: () => {
                              setSubVertical(12);
                              updatePreferences({ subtitlePosition: "top" });
                            },
                          },
                          {
                            key: "center",
                            label: "Center",
                            active: subVertical === 50,
                            onPress: () => {
                              setSubVertical(50);
                              updatePreferences({ subtitlePosition: "bottom" });
                            },
                          },
                          {
                            key: "lower",
                            label: "Lower",
                            active: subVertical === 75,
                            onPress: () => {
                              setSubVertical(75);
                              updatePreferences({ subtitlePosition: "bottom" });
                            },
                          },
                          {
                            key: "bottom",
                            label: "Bottom",
                            active: subVertical === 88,
                            onPress: () => {
                              setSubVertical(88);
                              updatePreferences({ subtitlePosition: "bottom" });
                            },
                          },
                        ]}
                      />

                    </>
                  </>
                )}
                {renderedMenu === "quality" && (
                  <Text className="text-foreground/50 text-[14px] px-5 py-5">
                    Original file quality. No video conversion.
                  </Text>
                )}
              </ScrollView>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
