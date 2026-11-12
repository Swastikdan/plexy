import {
isPictureInPictureSupported,
VideoView,
type AudioTrack,
type SubtitleTrack,
type VideoPlayer,
} from "expo-video";
import React from "react";
import {
Animated,
Modal,
Pressable,
ScrollView,
Text,
View,
} from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { useClient } from "../../../core/client/client-provider";
import type { ItemCard,Playability } from "../../../core/library/catalog-api";
import { cn } from "../../../shared/lib/cn";
import { timeLabel } from "../../../shared/theme";
import { Film,Minus,Play as PlayIcon,Plus } from "../../../shared/ui/icons";
import { PosterImage } from "../../../shared/ui/poster-image";
import { clampZoom,MAX_ZOOM,MIN_ZOOM } from "../lib/player-interactions";
import { IconCheck,IconClose } from "./player-icons";
import { SheetChips,SheetItem,SheetSection } from "./player-sheet";

interface PlayerDrawerProps {
  menu: "settings" | "audio" | "captions" | "quality" | "episodes" | null;
  setMenu: React.Dispatch<
    React.SetStateAction<
      "settings" | "audio" | "captions" | "quality" | "episodes" | null
    >
  >;
  drawerAnim: Animated.Value;
  sortedEpisodes: ItemCard[];
  reveal: () => void;
  episodesScrollRef: React.RefObject<ScrollView | null>;
  insets: EdgeInsets;
  manifest: Playability;
  drawerWatchedOverride: Record<number, boolean>;
  next: (id: number) => void;
  toggleDrawerEpWatched: (ep: ItemCard) => Promise<void>;
  player: VideoPlayer;
  fitMode: "fill" | "contain" | "cover";
  applyFit: (mode: "fill" | "contain" | "cover", scale: number) => void;
  zoom: number;
  diagnostics: boolean;
  setDiagnostics: React.Dispatch<React.SetStateAction<boolean>>;
  pip: React.RefObject<boolean>;
  video: React.RefObject<VideoView | null>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  nativeAudio: AudioTrack[];
  subtitle: string | null;
  setSubtitle: React.Dispatch<React.SetStateAction<string | null>>;
  setManifest: React.Dispatch<React.SetStateAction<Playability>>;
  nativeSubtitles: SubtitleTrack[];
  subVertical: number;
  setSubVertical: React.Dispatch<React.SetStateAction<number>>;
}

export function PlayerDrawer({
  menu,
  setMenu,
  drawerAnim,
  sortedEpisodes,
  reveal,
  episodesScrollRef,
  insets,
  manifest,
  drawerWatchedOverride,
  next,
  toggleDrawerEpWatched,
  player,
  fitMode,
  applyFit,
  zoom,
  diagnostics,
  setDiagnostics,
  pip,
  video,
  setMessage,
  nativeAudio,
  subtitle,
  setSubtitle,
  setManifest,
  nativeSubtitles,
  subVertical,
  setSubVertical,
}: PlayerDrawerProps) {
  const { api, platform, preferences, updatePreferences, progress } =
    useClient();
  return (
    <Modal
      visible={menu != null}
      transparent
      animationType="fade"
      onRequestClose={() => setMenu(null)}
      supportedOrientations={["portrait", "landscape"]}
    >
      <View className="flex-1 flex-row justify-end bg-black/60">
        <Pressable
          className="absolute inset-0"
          focusable={false}
          onPress={() => setMenu(null)}
        />
        <Animated.View
          className="h-full w-[48%] min-w-[380px] max-w-[540px] border-l border-white/10 bg-[#0d0e12]"
          style={{
            transform: [{ translateX: drawerAnim }],
            shadowColor: "#000",
            shadowOpacity: 0.5,
            shadowRadius: 20,
            elevation: 20,
          }}
        >
          <View className="flex-1">
            {/* Title row */}
            <View className="flex-row items-center justify-between border-b-[0.33px] border-border px-5 py-3.5">
              <Text className="text-white text-[17px] font-bold">
                {menu === "captions"
                  ? "Subtitles"
                  : menu === "audio"
                    ? "Audio tracks"
                    : menu === "quality"
                      ? "Video quality"
                      : menu === "episodes"
                        ? `Episodes (${sortedEpisodes.length})`
                        : "Player settings"}
              </Text>
              <Pressable
                focusable={true}
                onPress={() => {
                  setMenu(null);
                  reveal();
                }}
                className="h-8 w-8 rounded-[16px] bg-white/[0.12] items-center justify-center active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel="Close menu"
              >
                <IconClose size={18} color="#fff" />
              </Pressable>
            </View>

            {/* Episodes menu */}
            {menu === "episodes" && (
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
                      onPress={() => {
                        if (ep.fileId) {
                          setMenu(null);
                          next(ep.fileId);
                        }
                      }}
                      className={cn(
                        "flex-row items-center px-5 py-3 border-b-[0.33px] border-border active:opacity-[0.75]",
                        isCurrent &&
                          "bg-white/[0.08] border-l-[3px] border-l-white",
                      )}
                      accessibilityRole="button"
                      accessibilityLabel={`${epLabel}, ${ep.name}${isCurrent ? ", currently playing" : ""}`}
                    >
                      <View className="mr-3 h-[50px] w-[88px] overflow-hidden rounded-[6px] bg-white/[0.06]">
                        {ep.still || ep.backdrop || ep.poster ? (
                          <PosterImage
                            source={api.image(
                              ep.still || ep.backdrop || ep.poster,
                            )}
                            style={{ width: 88, height: 50, borderRadius: 6 }}
                          />
                        ) : (
                          <View className="h-[50px] w-[88px] items-center justify-center bg-white/[0.05]">
                            <Film size={18} color="rgba(255,255,255,0.3)" />
                          </View>
                        )}
                        {isCurrent && (
                          <View className="absolute inset-0 bg-white/75 items-center justify-center">
                            <PlayIcon
                              size={14}
                              color="#000000"
                              fill="#000000"
                            />
                          </View>
                        )}
                      </View>
                      <View className="flex-1 gap-[3px]">
                        <View className="flex-row items-center gap-2">
                          <Text
                            className={cn(
                              "text-[12px] font-bold tracking-[0.5px]",
                              isCurrent ? "text-white" : "text-white/60",
                            )}
                          >
                            {epLabel}
                          </Text>
                          {isCurrent && (
                            <View className="bg-white rounded-[4px] px-1.5 py-0.5">
                              <Text className="text-black text-[9px] font-archivo-bold tracking-[0.5px]">
                                NOW PLAYING
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          className={cn(
                            "text-[14px]",
                            isCurrent
                              ? "text-white font-bold"
                              : "text-white/90 font-semibold",
                          )}
                          numberOfLines={2}
                        >
                          {ep.name || `Episode ${ep.episodeNumber ?? idx + 1}`}
                        </Text>
                        {ep.watch?.duration ? (
                          <Text className="text-white/40 text-[12px]">
                            {timeLabel(ep.watch.duration)}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => void toggleDrawerEpWatched(ep)}
                        hitSlop={10}
                        className={cn(
                          "ml-2 h-9 w-9 rounded-full items-center justify-center active:opacity-60",
                          isEpWatched
                            ? "bg-[#22c55e]/[0.18]"
                            : "bg-white/[0.08]",
                        )}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isEpWatched ? "Mark unwatched" : "Mark watched"
                        }
                      >
                        <IconCheck
                          size={16}
                          color={
                            isEpWatched ? "#22c55e" : "rgba(255,255,255,0.4)"
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
                {/* Settings menu */}
                {menu === "settings" && (
                  <>
                    <SheetSection label="Playback" />
                    <SheetChips
                      label="Speed"
                      options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
                        key: String(rate),
                        label: `${rate}×`,
                        active: preferences.playbackRate === rate,
                        onPress: () => {
                          player.playbackRate = rate;
                          updatePreferences({ playbackRate: rate });
                        },
                      }))}
                    />

                    {
                      <>
                        <SheetSection label="Picture" />
                        <SheetChips
                          label="Fit"
                          options={[
                            {
                              key: "contain",
                              label: "Best fit",
                              active: fitMode === "contain",
                              onPress: () => applyFit("contain", zoom),
                            },
                            {
                              key: "cover",
                              label: "Crop",
                              active: fitMode === "cover",
                              onPress: () => applyFit("cover", zoom),
                            },
                            {
                              key: "fill",
                              label: "Stretch",
                              active: fitMode === "fill",
                              onPress: () => applyFit("fill", zoom),
                            },
                          ]}
                        />
                        <View className="flex-row items-center justify-between px-5 pt-[18px]">
                          <View>
                            <Text className="text-white text-[14px] font-semibold">
                              Manual zoom
                            </Text>
                            <Text className="text-white text-[18px] font-bold mt-1">
                              {Math.round(zoom * 100)}%
                            </Text>
                          </View>
                          <View className="flex-row gap-2">
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Decrease zoom by 5 percent"
                              disabled={zoom <= MIN_ZOOM}
                              onPress={() =>
                                applyFit(fitMode, clampZoom(zoom - 0.05))
                              }
                              className={cn(
                                "w-10 h-10 rounded-full bg-white/10 items-center justify-center",
                                zoom <= MIN_ZOOM && "opacity-40",
                              )}
                            >
                              <Minus size={18} color="#fff" />
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Increase zoom by 5 percent"
                              disabled={zoom >= MAX_ZOOM}
                              onPress={() =>
                                applyFit(fitMode, clampZoom(zoom + 0.05))
                              }
                              className={cn(
                                "w-10 h-10 rounded-full bg-white/10 items-center justify-center",
                                zoom >= MAX_ZOOM && "opacity-40",
                              )}
                            >
                              <Plus size={18} color="#fff" />
                            </Pressable>
                          </View>
                        </View>
                        <SheetChips
                          label="Zoom"
                          options={[1, 1.25, 1.5, 2].map((scale) => ({
                            key: String(scale),
                            label: `${Math.round(scale * 100)}%`,
                            active: zoom === scale,
                            onPress: () => applyFit(fitMode, scale),
                          }))}
                        />
                      </>
                    }

                    <SheetSection label="Player" />
                    <SheetItem
                      label="Playback diagnostics"
                      selected={diagnostics}
                      onPress={() => setDiagnostics((v) => !v)}
                    />
                    {isPictureInPictureSupported() && (
                      <SheetItem
                        label="Picture in picture"
                        onPress={() => {
                          setMenu(null);
                          pip.current = true;
                          void video.current
                            ?.startPictureInPicture()
                            .catch(() => {
                              pip.current = false;
                              setMessage(
                                "Picture in picture is unavailable on this device.",
                              );
                            });
                        }}
                      />
                    )}
                  </>
                )}

                {/* Audio tracks */}
                {menu === "audio" &&
                  (nativeAudio.length ? (
                    <>
                      <SheetSection label="Tracks" />
                      {nativeAudio.map((track) => (
                        <SheetItem
                          key={track.id}
                          label={
                            track.label ||
                            track.language ||
                            track.id ||
                            "Audio track"
                          }
                          selected={player.audioTrack?.id === track.id}
                          onPress={() => {
                            player.audioTrack = track;
                            setMenu(null);
                          }}
                        />
                      ))}
                    </>
                  ) : (
                    <Text className="text-white/50 text-[14px] px-5 py-5">
                      This file has a single audio track.
                    </Text>
                  ))}

                {/* Subtitles */}
                {menu === "captions" && (
                  <>
                    <SheetSection label="Track" />
                    <SheetItem
                      label="Off"
                      selected={!subtitle}
                      onPress={() => {
                        setSubtitle(null);
                        updatePreferences({ autoSubtitles: false });
                      }}
                    />
                    {manifest.tracks?.map((track) => (
                      <SheetItem
                        key={track.track}
                        label={track.title || track.language || track.track}
                        selected={subtitle === track.track}
                        onPress={() => {
                          setSubtitle(track.track);
                          updatePreferences({
                            autoSubtitles: true,
                            subtitleLanguage: track.language || "",
                          });
                        }}
                      />
                    ))}

                    {platform.local?.pickSubtitle && (
                      <SheetItem
                        label="Add subtitle file"
                        hint="SRT or VTT"
                        onPress={() => {
                          void platform.local!.pickSubtitle!(manifest.fileId)
                            .then((track) => {
                              if (!track) return;
                              setManifest((current) => ({
                                ...current,
                                tracks: [
                                  ...(current.tracks || []).filter(
                                    (t) => t.track !== track.track,
                                  ),
                                  track,
                                ],
                              }));
                              setSubtitle(track.track);
                              updatePreferences({ autoSubtitles: true });
                            })
                            .catch(() =>
                              setMessage(
                                "Could not add this subtitle file. Choose an SRT or VTT file.",
                              ),
                            );
                        }}
                      />
                    )}
                    {nativeSubtitles.map((track) => (
                      <SheetItem
                        key={`native:${track.id}`}
                        label={
                          track.label || track.language || "Embedded subtitles"
                        }
                        selected={subtitle === `native:${track.id}`}
                        onPress={() => {
                          setSubtitle(`native:${track.id}`);
                          updatePreferences({ autoSubtitles: true });
                        }}
                      />
                    ))}

                    <SheetSection label="Timing & appearance" />
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
                              subtitleOffset: preferences.subtitleOffset - 0.5,
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
                              subtitleOffset: preferences.subtitleOffset + 0.5,
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
                        <Text className="text-white text-[14px] font-semibold">
                          Vertical Position
                        </Text>
                        <Text className="text-white text-[18px] font-bold mt-1">
                          {subVertical}%
                        </Text>
                      </View>
                      <View className="flex-row gap-2">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Move subtitles higher"
                          onPress={() => {
                            const nextVal = Math.max(8, subVertical - 6);
                            setSubVertical(nextVal);
                            updatePreferences({
                              subtitlePosition: nextVal < 50 ? "top" : "bottom",
                            });
                          }}
                          className="w-10 h-10 rounded-full bg-white/10 items-center justify-center active:opacity-60"
                        >
                          <Minus size={18} color="#ffffff" strokeWidth={2.4} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Move subtitles lower"
                          onPress={() => {
                            const nextVal = Math.min(92, subVertical + 6);
                            setSubVertical(nextVal);
                            updatePreferences({
                              subtitlePosition: nextVal < 50 ? "top" : "bottom",
                            });
                          }}
                          className="w-10 h-10 rounded-full bg-white/10 items-center justify-center active:opacity-60"
                        >
                          <Plus size={18} color="#ffffff" strokeWidth={2.4} />
                        </Pressable>
                      </View>
                    </View>
                    <SheetChips
                      label="Position Presets"
                      options={[
                        {
                          key: "top",
                          label: "Top (12%)",
                          active: subVertical === 12,
                          onPress: () => {
                            setSubVertical(12);
                            updatePreferences({ subtitlePosition: "top" });
                          },
                        },
                        {
                          key: "center",
                          label: "Center (50%)",
                          active: subVertical === 50,
                          onPress: () => {
                            setSubVertical(50);
                            updatePreferences({ subtitlePosition: "bottom" });
                          },
                        },
                        {
                          key: "lower",
                          label: "Lower (75%)",
                          active: subVertical === 75,
                          onPress: () => {
                            setSubVertical(75);
                            updatePreferences({ subtitlePosition: "bottom" });
                          },
                        },
                        {
                          key: "bottom",
                          label: "Bottom (88%)",
                          active: subVertical === 88,
                          onPress: () => {
                            setSubVertical(88);
                            updatePreferences({ subtitlePosition: "bottom" });
                          },
                        },
                      ]}
                    />
                  </>
                )}

                {/* Quality */}
                {menu === "quality" && (
                  <Text className="text-white/50 text-[14px] px-5 py-5">
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

