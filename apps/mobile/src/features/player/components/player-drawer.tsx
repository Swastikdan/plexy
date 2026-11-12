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
StyleSheet,
Text,
View,
} from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { useClient } from "../../../core/client/client-provider";
import type { ItemCard,Playability } from "../../../core/library/catalog-api";
import { control,fonts,timeLabel } from "../../../shared/theme";
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
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          focusable={false}
          onPress={() => setMenu(null)}
        />
        <Animated.View
          style={[
            styles.sheetContainer,
            { transform: [{ translateX: drawerAnim }] },
          ]}
        >
          <View style={{ flex: 1 }}>
            {/* Title row */}
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>
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
                style={({ pressed }: any) => [
                  styles.sheetCloseBtn,
                  pressed && { opacity: 0.7 },
                ]}
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
                      style={({ pressed }) => [
                        styles.episodeItem,
                        isCurrent && styles.episodeItemCurrent,
                        pressed && { opacity: 0.75 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${epLabel}, ${ep.name}${isCurrent ? ", currently playing" : ""}`}
                    >
                      <View style={styles.episodeThumbContainer}>
                        {ep.still || ep.backdrop || ep.poster ? (
                          <PosterImage
                            source={api.image(
                              ep.still || ep.backdrop || ep.poster,
                            )}
                            style={styles.episodeThumb}
                          />
                        ) : (
                          <View style={styles.episodeThumbFallback}>
                            <Film size={18} color="rgba(255,255,255,0.3)" />
                          </View>
                        )}
                        {isCurrent && (
                          <View style={styles.episodeThumbActiveOverlay}>
                            <PlayIcon
                              size={14}
                              color="#000000"
                              fill="#000000"
                            />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <Text
                            style={[
                              styles.episodeBadge,
                              isCurrent && styles.episodeBadgeCurrent,
                            ]}
                          >
                            {epLabel}
                          </Text>
                          {isCurrent && (
                            <View style={styles.nowPlayingPill}>
                              <Text style={styles.nowPlayingText}>
                                NOW PLAYING
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.episodeItemTitle,
                            isCurrent && styles.episodeItemTitleCurrent,
                          ]}
                          numberOfLines={2}
                        >
                          {ep.name || `Episode ${ep.episodeNumber ?? idx + 1}`}
                        </Text>
                        {ep.watch?.duration ? (
                          <Text style={styles.episodeDuration}>
                            {timeLabel(ep.watch.duration)}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={() => void toggleDrawerEpWatched(ep)}
                        hitSlop={10}
                        style={({ pressed }) => [
                          styles.drawerEpWatchedBtn,
                          isEpWatched && styles.drawerEpWatchedBtnActive,
                          pressed && { opacity: 0.6 },
                        ]}
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
                        <View style={styles.sheetStepper}>
                          <View>
                            <Text style={styles.sheetChipsLabel}>
                              Manual zoom
                            </Text>
                            <Text style={styles.sheetStepperValue}>
                              {Math.round(zoom * 100)}%
                            </Text>
                          </View>
                          <View style={styles.sheetStepperButtons}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Decrease zoom by 5 percent"
                              disabled={zoom <= MIN_ZOOM}
                              onPress={() =>
                                applyFit(fitMode, clampZoom(zoom - 0.05))
                              }
                              style={[
                                styles.sheetStepperButton,
                                zoom <= MIN_ZOOM && { opacity: 0.4 },
                              ]}
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
                              style={[
                                styles.sheetStepperButton,
                                zoom >= MAX_ZOOM && { opacity: 0.4 },
                              ]}
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
                    <Text style={styles.sheetEmpty}>
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
                    <View style={styles.sheetStepper}>
                      <View>
                        <Text style={styles.sheetChipsLabel}>
                          Vertical Position
                        </Text>
                        <Text style={styles.sheetStepperValue}>
                          {subVertical}%
                        </Text>
                      </View>
                      <View style={styles.sheetStepperButtons}>
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
                          style={({ pressed }) => [
                            styles.sheetStepperButton,
                            pressed && { opacity: 0.6 },
                          ]}
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
                          style={({ pressed }) => [
                            styles.sheetStepperButton,
                            pressed && { opacity: 0.6 },
                          ]}
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
                  <Text style={styles.sheetEmpty}>
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

const styles = StyleSheet.create({
sheetBackdrop: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
sheetContainer: {
    backgroundColor: "#0d0e12",
    width: "48%",
    minWidth: 380,
    maxWidth: 540,
    height: "100%",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
sheetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
sheetTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
sheetChipsLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
sheetStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
  },
sheetStepperValue: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
sheetStepperButtons: {
    flexDirection: "row",
    gap: 8,
  },
sheetStepperButton: {
    width: 40,
    height: 40,
    borderRadius: control.radius,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
sheetEmpty: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
episodeItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
episodeItemCurrent: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderLeftWidth: 3,
    borderLeftColor: "#ffffff",
  },
episodeBadge: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
episodeBadgeCurrent: {
    color: "#ffffff",
  },
nowPlayingPill: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
nowPlayingText: {
    color: "#000000",
    fontSize: 9,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
  },
drawerEpWatchedBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
drawerEpWatchedBtnActive: {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
  },
episodeItemTitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "600",
  },
episodeItemTitleCurrent: {
    color: "#ffffff",
    fontWeight: "700",
  },
episodeDuration: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
  },
episodeThumbContainer: {
    width: 88,
    height: 50,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    marginRight: 12,
  },
episodeThumb: {
    width: 88,
    height: 50,
    borderRadius: 6,
  },
episodeThumbFallback: {
    width: 88,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
episodeThumbActiveOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.75)",
    alignItems: "center",
    justifyContent: "center",
  }
});
