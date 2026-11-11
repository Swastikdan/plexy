import React, { useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Search as SearchIcon, Play, ArrowLeft, Download, Check, Tv as TvIcon, Info, Film, RefreshCw, ChevronDown, ArrowUpDown, X, Trash2 } from "lucide-react-native";
import { useClient, useDownloads } from "../../../../packages/native-client/src/context";
import { useResource } from "../../../../packages/native-client/src/hooks";
import { Button, Card, Loading, Notice, PageHeader, PosterImage } from "../components/ui";
import { colors, fonts, timeLabel } from "../ui/theme";
import type { ItemCard } from "../../../../packages/native-client/src/api";
import { triggerHaptic } from "../../../../packages/native-client/src/haptics";

export type OpenTitle = (id: string | number) => void;

// ---------------------------------------------------------------------------
// Genre pill chip
// ---------------------------------------------------------------------------
function GenrePill({ label }: { label: string }) {
  return (
    <View style={styles.genrePill}>
      <Text style={styles.genrePillText}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hero Slide
// ---------------------------------------------------------------------------
export function Hero({
  item,
  logo,
  onOpen,
  actionLabel,
  disabled,
  onDetails,
  onTrailer,
  onToggleWatched,
  isWatched,
  onDownload,
  downloadState,
  onDelete,
  width,
  preferred,
  onHeroFocus,
}: {
  item: ItemCard;
  logo?: string | null;
  onOpen: () => void;
  actionLabel?: string;
  disabled?: boolean;
  onDetails?: () => void;
  onTrailer?: () => void;
  onToggleWatched?: () => void;
  isWatched?: boolean;
  onDownload?: () => void;
  downloadState?: { state: string; bytes: number; expected: number };
  onDelete?: () => void;
  width?: number;
  preferred?: boolean;
  onHeroFocus?: () => void;
}) {
  const { api, platform } = useClient();
  const [playFocus, setPlayFocus] = useState(false);
  const [detailFocus, setDetailFocus] = useState(false);
  const [trailerFocus, setTrailerFocus] = useState(false);
  const [watchedFocus, setWatchedFocus] = useState(false);
  const [downloadFocus, setDownloadFocus] = useState(false);
  const [deleteFocus, setDeleteFocus] = useState(false);
  const playLabel = actionLabel ?? (item.watch?.position ? "Continue" : "Play");

  // Build metadata line: Year, runtime, rating, episode info, and genres all in the same row
  const metaParts: React.ReactNode[] = [];
  if (item.year) metaParts.push(String(item.year));
  if (item.runtime) metaParts.push(`${item.runtime}m`);
  if ((item as any).seasonNumber != null && (item as any).episodeNumber != null) {
    metaParts.push(`S${(item as any).seasonNumber} E${(item as any).episodeNumber}`);
  }
  if (item.rating != null) {
    metaParts.push(
      <Text key="rating" style={styles.heroMetaRating}>
        ★ {item.rating.toFixed(1)}
      </Text>,
    );
  }
  if (item.genres?.length > 0) {
    metaParts.push(item.genres.slice(0, 3).join(", "));
  }

  return (
    <View
      style={[
        styles.heroContainer,
        { height: platform.tv ? 280 : 470 },
        width ? { width } : null,
      ]}
    >
      {item.backdrop ? (
        <PosterImage source={api.image(item.backdrop)} style={StyleSheet.absoluteFill as never} />
      ) : item.poster ? (
        <PosterImage source={api.image(item.poster)} style={StyleSheet.absoluteFill as never} />
      ) : null}

      {/* Top tint */}
      <LinearGradient
        colors={["rgba(0,0,0,0.65)", "transparent"]}
        style={[StyleSheet.absoluteFill, { height: "35%" }]}
        locations={[0, 1]}
      />

      {/* Bottom fade to canvas */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.72)", colors.canvas]}
        locations={[0.25, 0.68, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Content: Title full width, metadata with genres inline, Play button + Action icons */}
      <View
        style={[
          styles.heroContent,
          platform.tv && styles.heroContentTV,
        ]}
      >
        {/* Slide header: non-focusable, unselectable title, logo, metadata and overview */}
        <View style={styles.heroSlideHeader}>
          {logo ? (
            <Image
              source={api.image(logo)}
              accessibilityLabel={item.name}
              style={[
                styles.heroLogo,
                platform.tv && styles.heroLogoTV,
              ]}
              resizeMode="contain"
            />
          ) : (
            <Text
              style={[styles.heroTitle, platform.tv && styles.heroTitleTV]}
              numberOfLines={2}
              selectable={false}
            >
              {item.name}
            </Text>
          )}

          {/* Metadata row under title: Year, rating, and genres in the exact same row */}
          {metaParts.length > 0 && (
            <View style={styles.heroMetaRow}>
              {metaParts.map((part, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <Text style={styles.heroMetaDot}>·</Text>}
                  {typeof part === "string" ? (
                    <Text style={styles.heroMetaText} selectable={false}>{part}</Text>
                  ) : (
                    part
                  )}
                </React.Fragment>
              ))}
            </View>
          )}

          {/* 2-line synopsis / overview */}
          {!!item.overview && (
            <Text
              style={styles.heroOverview}
              numberOfLines={2}
              selectable={false}
            >
              {item.overview}
            </Text>
          )}
        </View>

        {/* CTA row: Big Play button (primary) + Action icon buttons */}
        <View style={styles.heroButtons}>
          <Pressable
            onPress={() => {
              triggerHaptic("medium");
              onOpen();
            }}
            disabled={disabled}
            onFocus={() => {
              setPlayFocus(true);
              onHeroFocus?.();
            }}
            onBlur={() => setPlayFocus(false)}
            hasTVPreferredFocus={platform.tv && preferred}
            style={({ pressed }) => [
              styles.heroPlayBtn,
              platform.tv && styles.heroPlayBtnTV,
              disabled && styles.heroBtnDisabled,
              platform.tv && playFocus && styles.heroFocusRing,
              platform.tv && playFocus && styles.heroPlayBtnFocused,
              pressed && styles.heroBtnPressed,
            ]}
          >
            <Play size={platform.tv ? 18 : 16} color={platform.tv ? "#fff" : "#000"} fill={platform.tv ? "#fff" : "#000"} />
            <Text style={[styles.heroPlayBtnText, platform.tv && styles.heroPlayBtnTextTV]}>
              {playLabel.replace(/^([▶▸]\s*)+/, "")}
            </Text>
          </Pressable>

          {/* Details button: larger icon button */}
          {onDetails && (
            <Pressable
              onPress={() => {
                triggerHaptic("light");
                onDetails();
              }}
              onFocus={() => {
                setDetailFocus(true);
                onHeroFocus?.();
              }}
              onBlur={() => setDetailFocus(false)}
              style={({ pressed }) => [
                styles.heroIconBtn,
                platform.tv && detailFocus && styles.heroIconBtnFocused,
                pressed && styles.heroBtnPressed,
              ]}
              hitSlop={10}
              accessibilityLabel="Details"
            >
              <Info size={platform.tv ? 22 : 20} color="#fff" strokeWidth={2.2} />
              {platform.tv && detailFocus && <View style={styles.iconBtnFocusRing} pointerEvents="none" />}
            </Pressable>
          )}

          {/* Trailer link button: larger icon button */}
          {onTrailer && (
            <Pressable
              onPress={() => {
                triggerHaptic("light");
                onTrailer();
              }}
              onFocus={() => {
                setTrailerFocus(true);
                onHeroFocus?.();
              }}
              onBlur={() => setTrailerFocus(false)}
              style={({ pressed }) => [
                styles.heroIconBtn,
                platform.tv && trailerFocus && styles.heroIconBtnFocused,
                pressed && styles.heroBtnPressed,
              ]}
              hitSlop={10}
              accessibilityLabel="Watch Trailer"
            >
              <Film size={platform.tv ? 22 : 20} color="#fff" strokeWidth={2.2} />
              {platform.tv && trailerFocus && <View style={styles.iconBtnFocusRing} pointerEvents="none" />}
            </Pressable>
          )}

          {/* Watched toggle button: larger icon button */}
          {onToggleWatched && (
            <Pressable
              onPress={() => {
                triggerHaptic("light");
                onToggleWatched();
              }}
              onFocus={() => {
                setWatchedFocus(true);
                onHeroFocus?.();
              }}
              onBlur={() => setWatchedFocus(false)}
              style={({ pressed }) => [
                styles.heroIconBtn,
                isWatched && styles.heroIconBtnWatched,
                platform.tv && watchedFocus && styles.heroIconBtnFocused,
                pressed && styles.heroBtnPressed,
              ]}
              hitSlop={8}
              accessibilityLabel={isWatched ? "Mark Unwatched" : "Mark Watched"}
            >
              <Check
                size={18}
                color={isWatched ? "#000000" : "#fff"}
                strokeWidth={isWatched ? 2.6 : 2}
              />
              {platform.tv && watchedFocus && <View style={styles.iconBtnFocusRing} pointerEvents="none" />}
            </Pressable>
          )}

          {/* Download button for movies / single media */}
          {onDownload && (
            <Pressable
              onPress={onDownload}
              onFocus={() => {
                setDownloadFocus(true);
                onHeroFocus?.();
              }}
              onBlur={() => setDownloadFocus(false)}
              style={({ pressed }) => [
                styles.heroIconBtn,
                downloadState?.state === "downloading" && { borderColor: colors.brand, width: "auto", minWidth: 48, paddingHorizontal: 12 },
                downloadState?.state === "completed" && { borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.18)" },
                platform.tv && downloadFocus && styles.heroIconBtnFocused,
                pressed && styles.heroBtnPressed,
              ]}
              hitSlop={8}
              accessibilityLabel="Download"
            >
              {downloadState?.state === "downloading" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Download size={16} color={colors.brand} strokeWidth={2.4} />
                  <Text style={{ color: colors.brand, fontSize: 12, fontFamily: fonts.bold }}>
                    {downloadState.expected ? `${Math.min(100, Math.round((downloadState.bytes / downloadState.expected) * 100))}%` : "..."}
                  </Text>
                </View>
              ) : downloadState?.state === "completed" ? (
                <Check size={18} color="#22c55e" strokeWidth={2.6} />
              ) : downloadState?.state === "queued" ? (
                <Text style={{ color: colors.muted, fontSize: 11, fontFamily: fonts.medium }}>Queued</Text>
              ) : (
                <Download size={18} color="#fff" strokeWidth={2} />
              )}
              {platform.tv && downloadFocus && <View style={styles.iconBtnFocusRing} pointerEvents="none" />}
            </Pressable>
          )}

          {/* Delete series / item button */}
          {onDelete && (
            <Pressable
              onPress={() => {
                triggerHaptic("medium");
                onDelete();
              }}
              onFocus={() => {
                setDeleteFocus(true);
                onHeroFocus?.();
              }}
              onBlur={() => setDeleteFocus(false)}
              style={({ pressed }) => [
                styles.heroIconBtn,
                styles.heroIconBtnDanger,
                platform.tv && deleteFocus && styles.heroIconBtnFocused,
                pressed && styles.heroBtnPressed,
              ]}
              hitSlop={8}
              accessibilityLabel="Delete"
            >
              <Trash2 size={18} color="#ef4444" strokeWidth={2.2} />
              {platform.tv && deleteFocus && <View style={styles.iconBtnFocusRing} pointerEvents="none" />}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// HeroCarousel
// ---------------------------------------------------------------------------
export function HeroCarousel({
  items,
  onPlay,
  open,
  onHeroFocus,
}: {
  items: ItemCard[];
  onPlay: (item: ItemCard) => void;
  open: OpenTitle;
  onHeroFocus?: () => void;
}) {
  const { width } = useWindowDimensions();
  const { platform } = useClient();
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusedDot, setFocusedDot] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const carouselScrollRef = useRef<ScrollView>(null);

  if (!items.length) return null;

  const slideWidth = containerWidth || (platform.tv ? width - 58 : width);

  const goToSlide = (idx: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    setActiveIndex(clamped);
    carouselScrollRef.current?.scrollTo({ x: clamped * slideWidth, animated: true });
  };

  return (
    <View
      style={{ width: "100%", position: "relative" }}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== containerWidth) setContainerWidth(w);
      }}
    >
      <ScrollView
        ref={carouselScrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / (slideWidth || 1));
          setActiveIndex(Math.max(0, Math.min(items.length - 1, index)));
        }}
        scrollEventThrottle={16}
      >
        {items.map((it, i) => (
          <Hero
            key={it.id}
            item={it}
            logo={it.logo}
            width={slideWidth}
            preferred={platform.tv && i === 0}
            onHeroFocus={onHeroFocus}
            onOpen={() => onPlay(it)}
            onDetails={() => open(it.publicId)}
          />
        ))}
      </ScrollView>

      {/* Pagination dots / interactive on TV */}
      {items.length > 1 && (
        <View style={[styles.carouselDots, platform.tv && styles.carouselDotsTV]} pointerEvents="box-none">
          {items.map((_, i) => (
            <Pressable
              key={i}
              focusable={platform.tv}
              onFocus={() => {
                setFocusedDot(i);
                goToSlide(i);
                onHeroFocus?.();
              }}
              onBlur={() => setFocusedDot(null)}
              onPress={() => goToSlide(i)}
              style={({ pressed }) => [
                styles.carouselDot,
                i === activeIndex && styles.carouselDotActive,
                focusedDot === i && styles.carouselDotFocused,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Slide ${i + 1} of ${items.length}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ContinueWatchingCard — wide 16:9 landscape format with instant play
// ---------------------------------------------------------------------------
export function ContinueWatchingCard({
  item,
  api,
  preferred,
  onPress,
  onFocus,
}: {
  item: ItemCard;
  api: any;
  preferred?: boolean;
  onPress: () => void;
  onFocus?: () => void;
}) {
  const position = item.watch?.position || 0;
  const duration = item.watch?.duration || (item.runtime ? item.runtime * 60 : 0);
  const remaining = duration > position ? duration - position : 0;
  const remainingLabel = remaining > 0 ? `${Math.ceil(remaining / 60)}m left` : (duration ? timeLabel(duration) : null);
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const isSeries = item.kind === "series";
  const epNumber = isSeries ? null : ((item as any).episodeNumber ?? item.episodeNumber);
  const epLabel = epNumber != null ? `E${epNumber}` : null;
  const rawName = String(item.name || "").trim();
  const cleanedName = rawName
    .replace(/^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i, "")
    .trim();

  const [focus, setFocus] = useState(false);

  const title = item.parentTitle || (cleanedName || rawName);
  let subtitle = isSeries
    ? "TV Series"
    : epNumber != null
      ? `Episode ${epNumber}${cleanedName && item.parentTitle ? ` · ${cleanedName}` : ""}`
      : item.year ? `${item.year}` : "Resume playing";
  // Never repeat the title as its own subtitle
  if (subtitle === title) {
    subtitle = isSeries ? "TV Series" : "";
  }

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      style={({ pressed }) => [
        styles.cwCard,
        Platform.isTV && focus && styles.cwCardFocused,
        preferred && Platform.isTV && styles.cwPreferred,
        pressed && { opacity: 0.8 },
      ]}
    >
      {/* 16:9 Thumbnail container */}
      <View style={styles.cwThumbWrap}>
        <PosterImage source={api.image(item.backdrop || item.poster)} />
        {!item.backdrop && !item.poster && (
          <View style={[styles.cwThumb, styles.cwThumbPlaceholder]} />
        )}

        {/* White focus ring when selected */}
        {focus && <View style={styles.cwFocusRing} pointerEvents="none" />}

        {/* Top-left badge: Episode number */}
        {epLabel && (
          <View style={styles.cwBadge}>
            <Text style={styles.cwBadgeText}>{epLabel}</Text>
          </View>
        )}

        {/* Top-right badge: Remaining time */}
        {remainingLabel && (
          <View style={styles.cwDuration}>
            <Text style={styles.cwDurationText}>{remainingLabel}</Text>
          </View>
        )}

        {/* Center play icon overlay */}
        <View style={styles.cwPlayCircle}>
          <Play size={16} color="#fff" fill="#fff" />
        </View>

        {/* Linear progress bar at the bottom */}
        {progressRatio > 0 && (
          <View style={styles.cwProgressBar}>
            <View style={[styles.cwProgressFill, { width: `${Math.round(progressRatio * 100)}%` }]} />
          </View>
        )}
      </View>

      {/* Info below thumbnail */}
      <View style={styles.cwInfo}>
        <Text style={styles.cwTitle} numberOfLines={1}>{title}</Text>
        {!!subtitle && (
          <Text style={styles.cwSubtitle} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// CatalogRow — horizontal scrolling section
// ---------------------------------------------------------------------------
function CatalogRow({
  title,
  items,
  open,
  onPlay,
  isContinueWatching = false,
  focusId,
  focused,
  onRowFocus,
}: {
  title: string;
  items: ItemCard[];
  open: OpenTitle;
  onPlay?: (item: ItemCard) => void;
  isContinueWatching?: boolean;
  focusId: number | null;
  focused: (id: number) => void;
  onRowFocus?: () => void;
}) {
  const { api, platform } = useClient();
  const ref = useRef<FlatList<ItemCard>>(null);
  const cardWidth = isContinueWatching
    ? (platform.tv ? 168 : 220)
    : (platform.tv ? 124 : 150);

  return (
    <View style={styles.rowContainer}>
      {/* Section header */}
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{title}</Text>
      </View>

      <FlatList
        ref={ref}
        horizontal
        data={items}
        getItemLayout={(_, index) => ({
          length: cardWidth + 12,
          offset: 16 + (cardWidth + 12) * index,
          index,
        })}
        keyExtractor={(item) => String(item.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowList}
        renderItem={({ item, index }) =>
          isContinueWatching ? (
            <ContinueWatchingCard
              item={item}
              api={api}
              onFocus={() => {
                onRowFocus?.();
                if (platform.tv)
                  ref.current?.scrollToIndex({
                    index,
                    viewPosition: 0.5,
                    animated: false,
                  });
              }}
              onPress={() => {
                if (onPlay) {
                  onPlay(item);
                } else {
                  open(item.publicId);
                }
              }}
            />
          ) : (
            <Card
              width={cardWidth}
              item={item}
              api={api}
              onFocus={() => {
                onRowFocus?.();
                if (platform.tv)
                  ref.current?.scrollToIndex({
                    index,
                    viewPosition: 0.5,
                    animated: false,
                  });
              }}
              onPress={() => {
                open(item.publicId);
              }}
            />
          )
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// HomeScreen
// ---------------------------------------------------------------------------
export function HomeScreen({
  open,
  play,
  focusId,
  focused,
  active,
}: {
  open: OpenTitle;
  play?: (fileId: number) => void;
  focusId: number | null;
  focused: (id: number) => void;
  active: boolean;
}) {
  const { api, platform, progress } = useClient();
  const data = useResource((signal) => api.home(signal), [api]);
  const previousActive = useRef(active);

  React.useEffect(() => {
    if (active && !previousActive.current)
      void progress
        .flush(api)
        .catch(() => {})
        .finally(data.retry);
    previousActive.current = active;
  }, [active, api, progress]);

  // Handler for instant playback
  const handlePlay = React.useCallback((item: ItemCard) => {
    if (item.fileId && play) {
      play(item.fileId);
      return;
    }
    // Fetch detail to get first playable fileId
    void api.detail(item.publicId).then((d) => {
      const fid =
        d.file?.fileId ||
        d.episodes?.find((e) => e.fileId && !e.watch?.played)?.fileId ||
        d.episodes?.find((e) => e.fileId)?.fileId;
      if (fid && play) {
        play(fid);
      } else {
        open(item.publicId);
      }
    }).catch(() => open(item.publicId));
  }, [api, play, open]);

  // Normalize any item: if it is an episode, convert to full TV series card
  const toFullSeriesOrMovie = React.useCallback((it: ItemCard): ItemCard => {
    if (it.kind === "episode") {
      const seriesId = it.parentId || it.id;
      return {
        ...it,
        id: seriesId,
        publicId: it.parentPublicId || it.publicId,
        name:
          it.parentTitle ||
          it.name
            .replace(
              /^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i,
              "",
            )
            .trim() ||
          it.name,
        kind: "series",
        seasonNumber: null,
        episodeNumber: null,
      };
    }
    return it;
  }, []);

  // Carousel items: up to 5 items (featured + items from rows) — movies and TV series only (NO episodes)
  const carouselItems = React.useMemo(() => {
    const list: ItemCard[] = [];
    const isShowOrMovie = (it: ItemCard) => it.kind === "movie" || it.kind === "series";

    if (data.value?.featured && isShowOrMovie(data.value.featured)) {
      list.push(data.value.featured);
    }
    if (data.value?.rows) {
      for (const row of data.value.rows) {
        if (row.key === "next" || row.key === "continue") continue;
        for (const it of row.items) {
          if (!isShowOrMovie(it)) continue;
          if (!list.some((existing) => existing.id === it.id)) {
            list.push(it);
          }
          if (list.length >= 5) break;
        }
        if (list.length >= 5) break;
      }
    }
    return list;
  }, [data.value]);

  // TV row-snap scrolling: rows record their vertical position so focus
  // entering a row snaps the page so the row header sits near the top,
  // instead of the page drifting "half way" through content.
  const scrollRef = useRef<ScrollView>(null);
  const rowYs = useRef<Record<string, number>>({});
  const snapToRow = React.useCallback((key: string) => {
    if (!Platform.isTV) return;
    const y = rowYs.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const recordRowY =
    (key: string) =>
    (e: { nativeEvent: { layout: { y: number } } }) => {
      rowYs.current[key] = e.nativeEvent.layout.y;
    };

  // Continue watching: only full series or movies with progress, deduplicated
  const continueItems = React.useMemo(() => {
    if (!data.value?.rows) return [];
    const continueRow = data.value.rows.find(
      (r) => r.key === "continue",
    );
    if (!continueRow) return [];
    const seen = new Set<string>();
    const list: ItemCard[] = [];
    for (const it of continueRow.items) {
      if (!it.watch?.position || it.watch?.played) continue;
      const normalized = toFullSeriesOrMovie(it);
      const key = `${normalized.kind}-${normalized.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(normalized);
    }
    return list;
  }, [data.value, toFullSeriesOrMovie]);

  // Other rows: filter out "next" (next up episodes) and continue watching, normalize to full titles
  const otherRows = React.useMemo(() => {
    if (!data.value?.rows) return [];
    const continueRowKey = data.value.rows.find(
      (r) => r.key === "continue",
    )?.key;
    return data.value.rows
      .filter((r) => r.key !== "next" && r.key !== continueRowKey)
      .map((r) => {
        const seen = new Set<string>();
        const items: ItemCard[] = [];
        for (const it of r.items) {
          const normalized = toFullSeriesOrMovie(it);
          const key = `${normalized.kind}-${normalized.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(normalized);
        }
        return { ...r, items };
      })
      .filter((r) => r.items.length > 0);
  }, [data.value, toFullSeriesOrMovie]);

  if (data.loading) return <Loading />;
  if (data.error) return <Notice message={data.error} retry={data.retry} />;

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.homeContainer}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={false}
      refreshControl={
        <RefreshControl
          refreshing={data.loading}
          onRefresh={data.retry}
          tintColor="#ffffff"
        />
      }
    >
      <PageHeader logo />

      {/* Hero Carousel */}
      {carouselItems.length > 0 && (
        <View onLayout={recordRowY("hero")}>
          <HeroCarousel
            items={carouselItems}
            onPlay={handlePlay}
            open={open}
            onHeroFocus={() => {
              if (focusId != null) focused(null as any);
              scrollRef.current?.scrollTo({ y: 0, animated: true });
            }}
          />
        </View>
      )}

      {/* Continue watching row with full series or movie cards */}
      {continueItems.length > 0 && (
        <View onLayout={recordRowY("cw")}>
          <CatalogRow
            key="continue-watching"
            title="Continue Watching"
            items={continueItems}
            open={open}
            onPlay={handlePlay}
            isContinueWatching={true}
            focusId={active ? focusId : null}
            focused={focused}
            onRowFocus={() => snapToRow("cw")}
          />
        </View>
      )}

      {/* Rest of the rows (full movies and series only) */}
      {otherRows.map((row) => (
        <View key={row.key} onLayout={recordRowY(row.key)}>
          <CatalogRow
            key={row.key}
            title={row.title}
            items={row.items}
            open={open}
            focusId={active ? focusId : null}
            focused={focused}
            onRowFocus={() => snapToRow(row.key)}
          />
        </View>
      ))}

      {!data.value?.rows.length && (
        <View style={{ padding: platform.tv ? 36 : 20 }}>
          <Notice message={platform.local ? "Your library is empty. Add a movie or series folder in Settings." : "Your library is empty. Add media to Plexy Server, then pull to refresh."} />
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// FilterChip — pill with a visible TV focus state
// ---------------------------------------------------------------------------
function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={onPress}
      style={[
        styles.filterChip,
        active && styles.filterChipActive,
        focus && styles.filterChipFocusedTv,
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          active && styles.filterChipTextActive,
          focus && styles.filterChipTextFocusedTv,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// LibraryScreen
// ---------------------------------------------------------------------------
export function LibraryScreen({
  kind,
  open,
  openDownloads,
  defaultSubTab,
}: {
  kind: "movie" | "series" | "anime";
  open: OpenTitle;
  openDownloads?: () => void;
  defaultSubTab?: "movie" | "series" | "anime" | "downloads";
}) {
  const { api, platform, progress } = useClient();
  const downloadEntries = useDownloads();
  const { width } = useWindowDimensions();
  type LibraryTab = "movie" | "series" | "anime" | "downloads";
  const [activeTab, setActiveTab] = useState<LibraryTab>(defaultSubTab || kind);
  const [dlFilter, setDlFilter] = useState<"all" | "movie" | "series">("all");
  const [sort, setSort] = useState("added");
  const [unwatched, setUnwatched] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [extra, setExtra] = useState<ItemCard[]>([]);
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [end, setEnd] = useState(false);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const ref = useRef<FlatList<ItemCard>>(null);

  // Probe movies, series, and anime to auto-hide empty tabs and set priority
  const movieProbe = useResource(
    (signal) => (defaultSubTab === "downloads" ? Promise.resolve({ items: [] }) : api.items("movie", 0, "name", signal)),
    [api, defaultSubTab, "movie-probe"],
  );
  const seriesProbe = useResource(
    (signal) => (defaultSubTab === "downloads" ? Promise.resolve({ items: [] }) : api.items("series", 0, "name", signal)),
    [api, defaultSubTab, "series-probe"],
  );
  const animeProbe = useResource(
    (signal) => (defaultSubTab === "downloads" ? Promise.resolve({ items: [] }) : api.items("anime", 0, "name", signal)),
    [api, defaultSubTab, "anime-probe"],
  );

  const hasMovies = (movieProbe.value?.items?.length ?? 0) > 0;
  const hasSeries = (seriesProbe.value?.items?.length ?? 0) > 0;
  const hasAnime = (animeProbe.value?.items?.length ?? 0) > 0;
  const probesDone = movieProbe.value != null && seriesProbe.value != null;

  React.useEffect(() => {
    if (defaultSubTab === "downloads") return;
    if (probesDone) {
      // Priority when multiple exist: Movies -> TV Shows -> Anime
      if (hasMovies) {
        if (!hasSeries && !hasAnime && activeTab !== "movie") setActiveTab("movie");
      } else if (hasSeries) {
        if (activeTab === "movie" || (activeTab === "anime" && !hasAnime)) {
          setActiveTab("series");
        }
      } else if (hasAnime) {
        if (activeTab === "movie" || activeTab === "series") {
          setActiveTab("anime");
        }
      }
    }
  }, [hasMovies, hasSeries, hasAnime, probesDone, defaultSubTab]);

  const libraryTabs = React.useMemo(() => {
    if (defaultSubTab === "downloads") return ["downloads"] as const;
    const base: LibraryTab[] = [];
    if (!probesDone) {
      base.push("movie", "series");
      if (!platform.tv) base.push("anime");
    } else {
      if (hasMovies) base.push("movie");
      if (hasSeries) base.push("series");
      if (hasAnime && !platform.tv) base.push("anime");
      if (base.length === 0) base.push("movie", "series");
    }
    if (!platform.tv && !platform.local) {
      base.push("downloads");
    }
    return base;
  }, [defaultSubTab, probesDone, hasMovies, hasSeries, hasAnime, platform.tv, platform.local]);

  const showLibTabs = libraryTabs.length > 1;

  const data = useResource(
    (signal) => (activeTab === "downloads" ? Promise.resolve({ items: [] }) : api.items(activeTab, 0, sort, signal, unwatched)),
    [api, activeTab, sort, unwatched],
  );

  // Construct offline downloaded media items
  const downloadedCards = React.useMemo(() => {
    const list: Array<ItemCard & { downloadCount?: number }> = [];
    const seriesMap = new Map<string, typeof downloadEntries>();

    downloadEntries.forEach((entry) => {
      const isEpisode =
        entry.item.kind === "episode" ||
        entry.seriesName != null ||
        entry.seasonNumber != null;
      if (isEpisode) {
        const name =
          entry.seriesName ||
          (entry.item as any).parentName ||
          entry.item.name.split(" - ")[0] ||
          "TV Show";
        if (!seriesMap.has(name)) seriesMap.set(name, []);
        seriesMap.get(name)!.push(entry);
      } else {
        const item = entry.item;
        const watch = progress.latest(item.id);
        list.push({
          ...item,
          poster: entry.localPosterUri || (item.poster?.startsWith("file://") ? item.poster : entry.localPosterUri) || item.poster,
          watch: watch
            ? {
                position: watch.position,
                duration: watch.duration || null,
                played: watch.played,
                percent: watch.played ? 100 : watch.duration ? Math.min(100, Math.round((watch.position / watch.duration) * 100)) : 0,
              }
            : item.watch,
        });
      }
    });

    seriesMap.forEach((eps, seriesName) => {
      const first = eps[0]!;
      const parentId =
        (first.manifest as any).parentItemId ||
        first.item.id;
      const publicId =
        first.manifest.parentPublicId ||
        (first.item as any).parentPublicId ||
        String(parentId);
      const poster = eps.find((e) => e.localPosterUri)?.localPosterUri || first.item.poster;
      const watchedCount = eps.filter(
        (e) => progress.latest(e.item.id)?.played || e.item.watch?.played,
      ).length;
      const allWatched = watchedCount === eps.length;

      list.push({
        id: parentId,
        publicId,
        name: seriesName,
        kind: "series",
        poster,
        overview: `${eps.length} downloaded episode${eps.length === 1 ? "" : "s"}`,
        downloadCount: eps.length,
        genres: [],
        year: first.item.year,
        runtime: null,
        watch: {
          position: watchedCount,
          duration: eps.length,
          played: allWatched,
          percent: eps.length > 0 ? Math.round((watchedCount / eps.length) * 100) : 0,
        },
      } as any);
    });

    return list;
  }, [downloadEntries, progress]);

  const filteredDownloadedItems = React.useMemo(() => {
    if (dlFilter === "movie") return downloadedCards.filter((i) => i.kind === "movie");
    if (dlFilter === "series") return downloadedCards.filter((i) => i.kind === "series");
    return downloadedCards;
  }, [downloadedCards, dlFilter]);

  const items = activeTab === "downloads" ? filteredDownloadedItems : [...(data.value?.items || []), ...extra];
  const available = width - (platform.tv ? 58 : 0) - 40;
  const columns = Math.max(2, Math.floor(available / (platform.tv ? 126 : 150)));
  const cardWidth = Math.floor(available / columns) - 10;

  function reset(nextSort: string, nextUnwatched: boolean) {
    setExtra([]);
    setEnd(false);
    setMoreError("");
    setSort(nextSort);
    setUnwatched(nextUnwatched);
  }

  async function loadMore() {
    if (activeTab === "downloads" || more || end || data.loading || !data.value || data.value.items.length < 60) return;
    setMore(true);
    setMoreError("");
    try {
      const result = await api.items(activeTab, items.length, sort, undefined, unwatched);
      setExtra((prev) => [
        ...prev,
        ...result.items.filter((item) => !items.some((i) => i.id === item.id)),
      ]);
      setEnd(result.items.length < 60);
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : "Could not load more titles.");
    } finally {
      setMore(false);
    }
  }

  const FILTERS: [string, string][] = [
    ["added", "Recently added"],
    ["name", "Name"],
    ["year", "Year"],
    ["rating", "Rating"],
  ];
  const sortLabel = FILTERS.find(([key]) => key === sort)?.[1] || "Name";

  return (
    <View style={styles.libraryRoot}>
      <PageHeader
        title="Libraries"
        right={
          activeTab !== "downloads" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sort and filter. ${sortLabel}${unwatched ? ", unwatched only" : ""}`}
              onPress={() => {
                triggerHaptic("light");
                setSortOpen(true);
              }}
              style={({ pressed }) => [
                styles.sortButton,
                sortOpen && styles.sortButtonOpen,
                pressed && { opacity: 0.72 },
              ]}
            >
              <ArrowUpDown size={14} color="#ffffff" strokeWidth={2} />
              <Text style={styles.sortButtonText} numberOfLines={1}>
                {sortLabel}
              </Text>
              <ChevronDown size={14} color={colors.muted} strokeWidth={2.2} />
            </Pressable>
          ) : null
        }
      />

      {/* Movies | TV Shows | Anime — full-width segmented control with real touch targets */}
      {showLibTabs && defaultSubTab !== "downloads" && (
        <View style={styles.libSegmentWrap}>
          <View style={styles.libSegment} accessibilityRole="tablist">
            {libraryTabs.map((tab) => {
              const active = activeTab === tab;
              const label =
                tab === "movie"
                  ? "Movies"
                  : tab === "series"
                    ? "TV Shows"
                    : tab === "anime"
                      ? "Anime"
                      : "Downloads";
              return (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    if (active) return;
                    triggerHaptic("selection");
                    setActiveTab(tab);
                    setExtra([]);
                    setEnd(false);
                    setMoreError("");
                  }}
                  style={({ pressed }) => [
                    styles.libSegmentItem,
                    active && styles.libSegmentItemActive,
                    pressed && !active && { opacity: 0.65 },
                  ]}
                >
                  <Text
                    style={[
                      styles.libSegmentText,
                      active && styles.libSegmentTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* Downloads filters */}
      {activeTab === "downloads" && (
        <View style={styles.dlFilterRow}>
          <FilterChip
            label={`All (${downloadedCards.length})`}
            active={dlFilter === "all"}
            onPress={() => setDlFilter("all")}
          />
          <FilterChip
            label={`Movies (${downloadedCards.filter((i) => i.kind === "movie").length})`}
            active={dlFilter === "movie"}
            onPress={() => setDlFilter("movie")}
          />
          <FilterChip
            label={`TV Shows (${downloadedCards.filter((i) => i.kind === "series").length})`}
            active={dlFilter === "series"}
            onPress={() => setDlFilter("series")}
          />
        </View>
      )}

      {/* Grid */}
      {activeTab !== "downloads" && data.loading ? (
        <Loading />
      ) : activeTab !== "downloads" && data.error ? (
        <Notice message={data.error} retry={data.retry} />
      ) : (
        <FlatList
          ref={ref}
          key={`${columns}-${activeTab}`}
          data={items}
          numColumns={columns}
          keyExtractor={(item) => String(item.id)}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={styles.libGrid}
          renderItem={({ item, index }) => (
            <Card
              width={cardWidth}
              item={item}
              api={api}
              preferred={platform.tv && item.id === focusedId}
              onFocus={() => {
                setFocusedId(item.id);
                if (platform.tv) {
                  // numColumns FlatList renders rows, so convert the flat
                  // index to a row and keep it near the top of the viewport
                  // with a plain offset scroll (scrollToIndex would target
                  // the wrong item and land the grid badly out of position).
                  const rowIndex = Math.floor(index / columns);
                  const cardHeight = Math.round(cardWidth * 1.5 + 30);
                  const rowStep = cardHeight + 16;
                  const target = rowIndex >= 3 ? (rowIndex - 2) * rowStep + 4 : 0;
                  ref.current?.scrollToOffset({
                    offset: Math.max(0, target),
                    animated: true,
                  });
                }
              }}
              onPress={() => {
                setFocusedId(item.id);
                open(item.publicId);
              }}
            />
          )}
          onScrollToIndexFailed={() => {}}
          ListEmptyComponent={
            <Notice
              message={
                activeTab === "downloads"
                  ? "No downloaded media on this device."
                  : "No titles match this filter."
              }
            />
          }
          ListFooterComponent={
            activeTab !== "downloads" ? (
              <View style={{ gap: 12, paddingTop: 8 }}>
                {!!moreError && <Notice message={moreError} />}
                {!end && data.value?.items?.length === 60 && (
                  <Button
                    label={more ? "Loading…" : "Load more"}
                    disabled={more}
                    onPress={() => void loadMore()}
                  />
                )}
              </View>
            ) : null
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
        />
      )}

      <Modal
        visible={sortOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSortOpen(false)}
      >
        <Pressable
          style={styles.sortBackdrop}
          onPress={() => setSortOpen(false)}
          accessibilityLabel="Close sort and filter"
        >
          <Pressable style={styles.sortSheet} onPress={() => {}}>
            <View style={styles.sortHandle} />
            <Text style={styles.sortTitle}>Sort & filter</Text>
            {FILTERS.map(([key, label]) => {
              const active = sort === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    triggerHaptic("selection");
                    reset(key, unwatched);
                    setSortOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.sortRow,
                    active && styles.sortRowActive,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Text
                    style={[
                      styles.sortRowText,
                      active && styles.sortRowTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                  {active && <Check size={18} color="#000000" strokeWidth={2.6} />}
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: unwatched }}
              onPress={() => {
                triggerHaptic("selection");
                reset(sort, !unwatched);
              }}
              style={({ pressed }) => [
                styles.sortRow,
                unwatched && styles.sortRowActive,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text
                style={[
                  styles.sortRowText,
                  unwatched && styles.sortRowTextActive,
                ]}
              >
                Unwatched only
              </Text>
              {unwatched && <Check size={18} color="#000000" strokeWidth={2.6} />}
            </Pressable>
            <View style={{ height: 16 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SearchScreen
// ---------------------------------------------------------------------------
export function SearchScreen({
  open,
  play,
}: {
  open: OpenTitle;
  play?: (fileId: number) => void;
}) {
  const { api } = useClient();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [focusId, focused] = useState<number | null>(null);
  const [inputFocus, setInputFocus] = useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const homeData = useResource(
    (signal) => (!debounced ? api.home(signal) : Promise.resolve(null)),
    [api, debounced],
  );

  const data = useResource(
    (signal) =>
      debounced
        ? api.search(debounced, signal)
        : Promise.resolve({ titles: [], episodes: [] }),
    [api, debounced],
  );

  const handlePlay = React.useCallback(
    (item: ItemCard) => {
      if (item.fileId && play) {
        play(item.fileId);
        return;
      }
      void api
        .detail(item.publicId)
        .then((d) => {
          const fid =
            d.file?.fileId ||
            d.episodes?.find((e) => e.fileId && !e.watch?.played)?.fileId ||
            d.episodes?.find((e) => e.fileId)?.fileId;
          if (fid && play) {
            play(fid);
          } else {
            open(item.publicId);
          }
        })
        .catch(() => open(item.publicId));
    },
    [api, play, open],
  );

  // Grid config (responsive cols for search results)
  const isTv = Platform.isTV;
  const available = width - (isTv ? 58 : 0) - 40;
  const columns = isTv ? Math.max(3, Math.floor(available / 126)) : 2;
  const cardWidth = Math.floor(available / columns) - 10;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.searchContainer}
      showsVerticalScrollIndicator={false}
    >
      <PageHeader title="Search" />

      {/* Compact search field with an explicit search affordance */}
      <View
        style={[
          styles.searchInputWrap,
          Platform.isTV && styles.searchInputWrapTv,
          inputFocus && styles.searchInputWrapFocused,
        ]}
      >
        <SearchIcon size={18} color={inputFocus ? "#ffffff" : colors.muted} strokeWidth={2.1} />
        <TextInput
          style={[
            styles.searchInput,
            Platform.isTV && styles.searchInputTv,
          ]}
          value={query}
          onChangeText={setQuery}
          placeholder="Movies, shows and episodes"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          autoCorrect={false}
          onFocus={() => setInputFocus(true)}
          onBlur={() => setInputFocus(false)}
        />
        {!!query && (
          <Pressable
            onPress={() => setQuery("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            style={({ pressed }) => [styles.searchClear, pressed && { opacity: 0.6 }]}
          >
            <X size={15} color={colors.muted} strokeWidth={2.4} />
          </Pressable>
        )}
      </View>

      {/* States */}
      {debounced && data.loading ? (
        <Loading />
      ) : debounced && data.error ? (
        <Notice message={data.error} retry={data.retry} />
      ) : !debounced ? (
        homeData.loading ? (
          <Loading />
        ) : (
          <>
            {homeData.value?.rows.map((row) => {
              const isContinue = row.key === "continue";
              if (isContinue) {
                return (
                  <CatalogRow
                    key={row.key}
                    title={row.title}
                    items={row.items.filter((i) => i.watch?.position && !i.watch?.played)}
                    open={open}
                    onPlay={handlePlay}
                    isContinueWatching={true}
                    focusId={focusId}
                    focused={focused}
                  />
                );
              }
              return (
                <SearchGrid
                  key={row.key}
                  title={row.title}
                  items={row.items}
                  open={open}
                  focusId={focusId}
                  focused={focused}
                  cardWidth={cardWidth}
                  columns={columns}
                />
              );
            })}
            {!homeData.value?.rows.length && (
              <Text style={styles.searchHint}>Find a title or an episode in your library.</Text>
            )}
          </>
        )
      ) : !data.value?.titles.length && !data.value?.episodes.length ? (
        <Notice message="No results. Try another title." />
      ) : (
        <>
          {!!data.value?.titles.length && (
            <SearchGrid
              title="Movies & Shows"
              items={data.value.titles}
              open={open}
              focusId={focusId}
              focused={focused}
              cardWidth={cardWidth}
              columns={columns}
            />
          )}
          {!!data.value?.episodes.length && (
            <SearchGrid
              title="Episodes"
              items={data.value.episodes}
              open={open}
              focusId={focusId}
              focused={focused}
              cardWidth={cardWidth}
              columns={columns}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

function SearchGrid({
  title,
  items,
  open,
  focusId,
  focused,
  cardWidth,
  columns,
}: {
  title: string;
  items: ItemCard[];
  open: OpenTitle;
  focusId: number | null;
  focused: (id: number) => void;
  cardWidth: number;
  columns: number;
}) {
  const { api } = useClient();
  return (
    <View style={styles.searchGridSection}>
      <Text style={styles.rowTitle}>{title}</Text>
      <View style={styles.searchGrid}>
        {items.map((item) => (
          <Card
            key={item.id}
            width={cardWidth}
            item={item}
            api={api}
            preferred={focusId === item.id}
            onFocus={() => focused(item.id)}
            onPress={() => {
              focused(item.id);
              open(item.publicId);
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// DetailScreen
// ---------------------------------------------------------------------------
export function DetailScreen({
  id,
  back,
  play,
  download,
}: {
  id: string | number;
  back: () => void;
  play: (fileId: number) => void;
  download: (item: ItemCard, fileId: number) => void;
}) {
  const { api, platform, progress, downloads, preferences } = useClient();
  const downloadEntries = useDownloads();
  const data = useResource((signal) => api.detail(id, signal), [api, id]);
  const [season, setSeason] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<"episodes" | "details">("episodes");
  const [tabFocus, setTabFocus] = useState<string | null>(null);
  const [seasonFocus, setSeasonFocus] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [downloadingSeason, setDownloadingSeason] = useState(false);
  const [overrideWatched, setOverrideWatched] = useState<boolean | null>(null);
  const [episodesWatchedOverride, setEpisodesWatchedOverride] = useState<Record<number, boolean>>({});

  // Check for offline download entries matching this id
  const offlineMatches = React.useMemo(() => {
    return downloadEntries.filter((e) => {
      if (String(e.fileId) === String(id)) return true;
      if (String(e.item.id) === String(id)) return true;
      if (e.item.publicId === String(id)) return true;
      if ((e.item as any).parentPublicId === String(id)) return true;
      if (String((e.item as any).parentItemId) === String(id)) return true;
      if (e.manifest?.parentPublicId === String(id)) return true;
      if (String((e.manifest as any)?.parentItemId) === String(id)) return true;
      if (e.seriesName && (e.seriesName === String(id) || e.item.name === String(id))) return true;
      return false;
    });
  }, [downloadEntries, id]);

  const synthesizedDetail = React.useMemo(() => {
    if (!offlineMatches.length) return null;
    const first = offlineMatches[0]!;
    const isEpisode =
      first.item.kind === "episode" ||
      first.seriesName != null ||
      first.seasonNumber != null;

    if (!isEpisode) {
      const watch = progress.latest(first.item.id);
      const isPlayed = watch?.played ?? Boolean(first.item.watch?.played);
      const pos = watch?.position ?? first.item.watch?.position ?? 0;
      const dur = watch?.duration ?? first.item.watch?.duration ?? null;
      const pct = isPlayed ? 100 : dur ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
      return {
        item: {
          ...first.item,
          poster: first.localPosterUri || first.item.poster,
          watch: {
            position: pos,
            duration: dur,
            played: isPlayed,
            percent: pct,
          },
        },
        file: {
          fileId: first.fileId,
          height: first.maxHeight,
          videoCodec: null as string | null,
          hdr: null as string | null,
          container: null as string | null,
        },
        trailer: null as { provider: string; key: string } | null,
        metadata: {
          overview: first.item.overview,
        },
        cast: [],
        seasons: [],
        episodes: [],
      };
    }

    // Series: group episodes by season
    const seasonMap = new Map<number, typeof offlineMatches>();
    offlineMatches.forEach((e) => {
      const sNum = e.seasonNumber ?? (e.manifest.seasonNumber ?? 1);
      if (!seasonMap.has(sNum)) seasonMap.set(sNum, []);
      seasonMap.get(sNum)!.push(e);
    });

    const seasons = Array.from(seasonMap.keys())
      .sort((a, b) => a - b)
      .map((sNum) => ({
        number: sNum,
        name: `Season ${sNum}`,
      }));

    const episodes = offlineMatches
      .sort((a, b) => {
        const sDiff = (a.seasonNumber ?? 1) - (b.seasonNumber ?? 1);
        if (sDiff !== 0) return sDiff;
        return (a.episodeNumber ?? 1) - (b.episodeNumber ?? 1);
      })
      .map((e) => {
        const epWatch = progress.latest(e.item.id);
        const epPlayed = epWatch?.played ?? Boolean(e.item.watch?.played);
        const epPos = epWatch?.position ?? e.item.watch?.position ?? 0;
        const epDur = epWatch?.duration ?? e.item.watch?.duration ?? null;
        const epPct = epPlayed ? 100 : epDur ? Math.min(100, Math.round((epPos / epDur) * 100)) : 0;
        return {
          id: e.item.id,
          name: e.item.name,
          overview: e.item.overview,
          seasonNumber: e.seasonNumber ?? (e.manifest.seasonNumber ?? 1),
          episodeNumber: e.episodeNumber ?? (e.manifest.episodeNumber ?? 1),
          runtime: e.item.runtime,
          poster: e.localPosterUri || e.item.poster,
          fileId: e.fileId,
          watch: {
            position: epPos,
            duration: epDur,
            played: epPlayed,
            percent: epPct,
          },
        };
      });

    const parentId =
      (first.manifest as any).parentItemId ||
      (first.item as any).parentItemId ||
      first.item.id;
    const publicId =
      first.manifest.parentPublicId ||
      (first.item as any).parentPublicId ||
      String(parentId);
    const seriesTitle =
      first.seriesName ||
      (first.item as any).parentName ||
      first.item.name;

    const allWatched = episodes.length > 0 && episodes.every((ep) => ep.watch?.played);
    const watchedCount = episodes.filter((ep) => ep.watch?.played).length;

    return {
      item: {
        ...first.item,
        id: parentId,
        publicId,
        name: seriesTitle,
        kind: "series" as const,
        poster: first.localPosterUri || first.item.poster,
        overview: `${episodes.length} downloaded episode${episodes.length === 1 ? "" : "s"} available offline.`,
        genres: first.item.genres || [],
        year: first.item.year,
        runtime: null,
        watch: {
          position: watchedCount,
          duration: episodes.length,
          played: allWatched,
          percent: episodes.length > 0 ? Math.round((watchedCount / episodes.length) * 100) : 0,
        },
      },
      file: undefined,
      trailer: null as { provider: string; key: string } | null,
      metadata: {
        overview: `${episodes.length} downloaded episode${episodes.length === 1 ? "" : "s"} available offline.`,
      },
      seasons,
      episodes,
      cast: [],
    };
  }, [offlineMatches, progress]);

  // Merge server detail or fallback to offline synthesized detail
  const detail = React.useMemo(() => {
    const raw = data.value || synthesizedDetail;
    if (!raw) return null;
    const itemPoster =
      offlineMatches.find((e) => e.localPosterUri)?.localPosterUri ||
      raw.item.poster;
    const itemWatch = progress.latest(raw.item.id);
    const rawItemWatch = raw.item.watch;
    const played = itemWatch ? itemWatch.played : Boolean(rawItemWatch?.played);
    const pos = itemWatch ? itemWatch.position : (rawItemWatch?.position ?? 0);
    const dur = itemWatch ? (itemWatch.duration || null) : (rawItemWatch?.duration ?? null);
    const pct = played ? 100 : dur ? Math.min(100, Math.round((pos / dur) * 100)) : (rawItemWatch?.percent ?? 0);

    const mergedWatch = {
      position: pos,
      duration: dur,
      played,
      percent: pct,
    };

    const enrichedEpisodes = raw.episodes?.map((ep: any) => {
      const match = downloadEntries.find((d) => d.fileId === ep.fileId);
      const epPoster = match?.localPosterUri || ep.poster;
      const epWatch = progress.latest(ep.id);
      const epPlayed = epWatch ? epWatch.played : Boolean(ep.watch?.played);
      const epPos = epWatch ? epWatch.position : (ep.watch?.position ?? 0);
      const epDur = epWatch ? epWatch.duration : (ep.watch?.duration ?? null);
      const epPct = epPlayed ? 100 : epDur ? Math.min(100, Math.round((epPos / epDur) * 100)) : (ep.watch?.percent ?? 0);
      return {
        ...ep,
        poster: epPoster,
        watch: {
          position: epPos,
          duration: epDur,
          played: epPlayed,
          percent: epPct,
        },
      };
    });

    return {
      ...raw,
      item: {
        ...raw.item,
        poster: itemPoster,
        watch: mergedWatch,
      },
      episodes: enrichedEpisodes || raw.episodes,
    };
  }, [data.value, synthesizedDetail, offlineMatches, downloadEntries, progress]);

  const item = detail?.item;
  const isSeriesWatched = overrideWatched ?? Boolean(item?.watch?.played);

  async function watched() {
    if (!item) return;
    const nextPlayed = !isSeriesWatched;
    setOverrideWatched(nextPlayed);

    // Optimistically update all episodes to completed (or unwatched)
    const newOverrides: Record<number, boolean> = {};
    if (detail?.episodes) {
      detail.episodes.forEach((ep: any) => {
        newOverrides[ep.id] = nextPlayed;
      });
      setEpisodesWatchedOverride((prev) => ({ ...prev, ...newOverrides }));
    }

    try {
      await progress.flush(api);
      if (nextPlayed) {
        if (detail?.episodes) {
          for (const ep of detail.episodes) {
            const dur = ep.runtime ? ep.runtime * 60 : 3600;
            await progress.record({
              itemId: ep.id,
              position: dur,
              duration: dur,
              played: true,
              updatedAt: Date.now(),
            });
          }
        }
        await progress.record({
          itemId: item.id,
          position: 100,
          duration: 100,
          played: true,
          updatedAt: Date.now(),
        });
      } else {
        if (detail?.episodes) {
          for (const ep of detail.episodes) {
            await progress.forget(ep.id);
          }
        }
        await progress.forget(item.id);
      }

      await api.watched(item.id, nextPlayed);
      data.retry();
    } catch (e) {
      if (!synthesizedDetail) {
        setActionError(e instanceof Error ? e.message : "Could not update watched state.");
      }
    }
  }

  async function toggleEpisodeWatched(ep: any) {
    const currentEpPlayed = episodesWatchedOverride[ep.id] ?? (progress.latest(ep.id)?.played || Boolean(ep.watch?.played));
    const nextPlayed = !currentEpPlayed;
    setEpisodesWatchedOverride((prev) => ({ ...prev, [ep.id]: nextPlayed }));
    try {
      if (nextPlayed) {
        const dur = ep.runtime ? ep.runtime * 60 : 3600;
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
  }

  // Find first playable episode
  function getFirstPlayableFileId() {
    if (detail?.file?.fileId) return detail.file.fileId;
    const ep =
      detail?.episodes?.find((e: any) => e.fileId && !e.watch?.played) ||
      detail?.episodes?.find((e: any) => e.fileId);
    return ep?.fileId ?? null;
  }

  const selectedSeason = season ?? detail?.seasons?.[0]?.number;
  const seasonEpisodes = (detail?.episodes || []).filter(
    (e: any) => (selectedSeason == null || e.seasonNumber === selectedSeason) && e.fileId,
  );
  const completedSeasonEpisodes = seasonEpisodes.filter((e: any) =>
    downloadEntries.some((d) => d.fileId === e.fileId && d.state === "completed"),
  );
  const activeSeasonEpisodes = seasonEpisodes.filter((e: any) =>
    downloadEntries.some((d) => d.fileId === e.fileId && (d.state === "downloading" || d.state === "queued")),
  );
  const isSeasonDownloaded = seasonEpisodes.length > 0 && completedSeasonEpisodes.length === seasonEpisodes.length;
  const isSeasonDownloading = activeSeasonEpisodes.length > 0;

  async function downloadWholeSeason() {
    if (!seasonEpisodes.length || isSeasonDownloaded || !item) return;
    setDownloadingSeason(true);
    try {
      for (const ep of seasonEpisodes) {
        const alreadyQueued = downloadEntries.some(
          (d) => d.fileId === ep.fileId && (d.state === "completed" || d.state === "downloading" || d.state === "queued"),
        );
        if (alreadyQueued) continue;

        try {
          const manifest = await api.play(ep.fileId);
          const maxHeight = preferences.defaultDownloadHeight;
          const epItem: ItemCard = {
            ...item,
            id: ep.id,
            name: ep.name || `Episode ${ep.episodeNumber}`,
            poster: ep.poster || item.poster,
            kind: "episode",
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
          };
          (epItem as any).seriesName = item.name;
          await downloads.enqueue(
            epItem,
            manifest,
            ep.fileId,
            `${item.name} S${ep.seasonNumber}E${ep.episodeNumber}`,
            maxHeight,
          );
        } catch (err) {
          console.warn("Failed to enqueue episode", ep.id, err);
        }
      }
    } finally {
      setDownloadingSeason(false);
    }
  }

  const hasEpisodes = Boolean(detail?.episodes?.length);
  const movieDl = detail?.file ? downloadEntries.find((d) => d.fileId === detail.file!.fileId) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Floating Back button pinned at top-left */}
      <Pressable
        onPress={back}
        style={({ pressed }) => [styles.detailBack, pressed && { opacity: 0.6 }]}
        hitSlop={14}
      >
        <ArrowLeft size={22} color="#fff" strokeWidth={2} />
      </Pressable>

      <ScrollView
        contentContainerStyle={styles.detailContainer}
        showsVerticalScrollIndicator={false}
      >
        {data.loading && !detail ? (
          <View style={{ padding: 32 }}>
            <Loading />
          </View>
        ) : data.error && !detail ? (
          <View style={{ padding: 24 }}>
            <Notice message={data.error} retry={data.retry} />
          </View>
        ) : (
          detail &&
          item && (
            <>
              {/* Hero section */}
              <Hero
                item={item}
                logo={"logo" in detail && (detail as any).logo ? (detail as any).logo : item.logo}
                preferred={true}
                actionLabel={
                  item.watch?.position && !isSeriesWatched ? "Resume" : "Play"
                }
                disabled={!getFirstPlayableFileId()}
                onOpen={() => {
                  const fileId = getFirstPlayableFileId();
                  if (fileId) play(fileId);
                }}
                onTrailer={
                  detail.trailer?.provider?.toLowerCase() === "youtube"
                    ? () => {
                        void Linking.openURL(
                          `https://www.youtube.com/watch?v=${encodeURIComponent(detail.trailer!.key)}`,
                        ).catch(() => setActionError("No app is available to open this trailer."));
                      }
                    : undefined
                }
                onToggleWatched={() => void watched()}
                isWatched={isSeriesWatched}
                onDownload={!platform.local && detail.file ? () => download(item, detail.file!.fileId) : undefined}
                downloadState={movieDl}
                onDelete={() => {
                  const isSeries = hasEpisodes || item.kind === "series";
                  Alert.alert(
                    isSeries ? "Delete Series?" : "Delete Movie?",
                    isSeries
                      ? `Are you sure you want to delete "${item.name}"? All episode video files will be permanently deleted from your device storage.`
                      : `Are you sure you want to delete "${item.name}"? The video file will be permanently deleted from your device storage.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            await api.deleteItem(item.id);
                            back();
                          } catch (err) {
                            setActionError(err instanceof Error ? err.message : String(err));
                          }
                        },
                      },
                    ]
                  );
                }}
              />

              <View style={[styles.detailBody, platform.tv && styles.detailBodyTV]}>
                {!!actionError && <Notice message={actionError} />}

                {/* If TV show with episodes, display Tab Selector: Episodes | Cast & Details */}
                {hasEpisodes ? (
                  <>
                    <View style={styles.detailTabBar}>
                      <Pressable
                        onPress={() => setDetailTab("episodes")}
                        onFocus={() => setTabFocus("episodes")}
                        onBlur={() => setTabFocus(null)}
                        style={[
                          styles.detailTabItem,
                          detailTab === "episodes" && styles.detailTabItemActive,
                          tabFocus === "episodes" && styles.detailTabItemFocusedTv,
                        ]}
                      >
                        <Text style={[styles.detailTabItemText, detailTab === "episodes" && styles.detailTabItemTextActive]}>
                          Episodes
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setDetailTab("details")}
                        onFocus={() => setTabFocus("details")}
                        onBlur={() => setTabFocus(null)}
                        style={[
                          styles.detailTabItem,
                          detailTab === "details" && styles.detailTabItemActive,
                          tabFocus === "details" && styles.detailTabItemFocusedTv,
                        ]}
                      >
                        <Text style={[styles.detailTabItemText, detailTab === "details" && styles.detailTabItemTextActive]}>
                          Cast & Details
                        </Text>
                      </Pressable>
                    </View>

                    {detailTab === "episodes" ? (
                      <>
                        {/* Multiple seasons: prominent Choose Season option */}
                        {!!detail.seasons?.length && detail.seasons.length > 1 && (
                          <View style={{ gap: 8 }}>
                            <Text style={styles.detailSectionLabel}>Choose Season</Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={{ gap: 8 }}
                            >
                              {detail.seasons.map((s: any) => {
                                const active = selectedSeason === s.number;
                                return (
                                  <Pressable
                                    key={s.number}
                                    onPress={() => setSeason(s.number)}
                                    onFocus={() => setSeasonFocus(s.number)}
                                    onBlur={() => setSeasonFocus(null)}
                                    style={[
                                      styles.seasonPill,
                                      { flexDirection: "row", alignItems: "center" },
                                      active && styles.seasonPillActive,
                                      seasonFocus === s.number && styles.seasonPillFocusedTv,
                                    ]}
                                  >
                                    {!!s.poster && <Image source={api.image(s.poster)} style={{width:28,height:42,borderRadius:3,marginRight:8}} resizeMode="cover" />}
                                    <Text style={[styles.seasonPillText, active && styles.seasonPillTextActive]}>
                                      {s.name || `Season ${s.number}`}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}

                        {/* Download whole season button */}
                        {seasonEpisodes.length > 0 && !platform.tv && !platform.local && (
                          <View style={styles.seasonDownloadBar}>
                            <Pressable
                              onPress={() => void downloadWholeSeason()}
                              disabled={isSeasonDownloaded || isSeasonDownloading || downloadingSeason}
                              style={({ pressed }) => [
                                styles.downloadSeasonBtn,
                                isSeasonDownloaded && styles.downloadSeasonBtnCompleted,
                                (isSeasonDownloading || downloadingSeason) && styles.downloadSeasonBtnActive,
                                pressed && { opacity: 0.8 },
                              ]}
                            >
                              {isSeasonDownloaded ? (
                                <>
                                  <Check size={16} color="#22c55e" strokeWidth={2.5} />
                                  <Text style={styles.downloadSeasonBtnTextCompleted}>
                                    Season {selectedSeason ?? 1} Downloaded
                                  </Text>
                                </>
                              ) : isSeasonDownloading || downloadingSeason ? (
                                <>
                                  <Download size={16} color={colors.brand} strokeWidth={2.2} />
                                  <Text style={styles.downloadSeasonBtnTextActive}>
                                    Downloading Season {selectedSeason ?? 1} ({activeSeasonEpisodes.length || seasonEpisodes.length} remaining)
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <Download size={16} color="#ffffff" strokeWidth={2} />
                                  <Text style={styles.downloadSeasonBtnText}>
                                    Download Season {selectedSeason ?? 1} ({seasonEpisodes.length} {seasonEpisodes.length === 1 ? "Episode" : "Episodes"})
                                  </Text>
                                </>
                              )}
                            </Pressable>
                          </View>
                        )}

                        {/* Episodes list */}
                        {detail.episodes
                          ?.filter((e: any) => selectedSeason == null || e.seasonNumber === selectedSeason)
                          .map((ep: any) => {
                            const isEpWatched = episodesWatchedOverride[ep.id] ?? (progress.latest(ep.id)?.played || Boolean(ep.watch?.played));
                            return (
                              <EpisodeCard
                                key={ep.id}
                                ep={{
                                  ...ep,
                                  watch: {
                                    ...ep.watch,
                                    played: isEpWatched,
                                    position: isEpWatched ? (ep.watch?.duration || (ep.runtime ? ep.runtime * 60 : 3600)) : (ep.watch?.position || 0),
                                  },
                                }}
                                api={api}
                                platform={platform}
                                play={play}
                                download={download}
                                item={item}
                                onToggleWatched={toggleEpisodeWatched}
                              />
                            );
                          })}
                      </>
                    ) : (
                      <>
                        {/* Overview */}
                        <Text style={styles.detailOverview}>
                          {detail.metadata?.overview || item.overview || "No synopsis is available."}
                        </Text>

                        {/* File quality info */}
                        {detail.file && (
                          <Text style={styles.detailQuality}>
                            {[
                              detail.file.height ? `${detail.file.height}p` : null,
                              (detail.file as any).videoCodec?.toUpperCase(),
                              (detail.file as any).hdr,
                              (detail.file as any).container?.toUpperCase(),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        )}

                        {/* Cast */}
                        {!!detail.cast?.length && (
                          <View style={{ gap: 12 }}>
                            <Text style={styles.detailSectionLabel}>Cast & Crew</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
                              {detail.cast.map((person: any, i: number) => (
                                <View key={`${person.name}-${i}`} style={styles.castCard}>
                                  {person.photo ? (
                                    <Image
                                      source={api.image(person.photo)}
                                      style={styles.castPhoto}
                                    />
                                  ) : (
                                    <View style={[styles.castPhoto, styles.castPhotoPlaceholder]}>
                                      <Text style={styles.castInitial}>
                                        {person.name?.[0]?.toUpperCase()}
                                      </Text>
                                    </View>
                                  )}
                                  <Text style={styles.castName} numberOfLines={2}>{person.name}</Text>
                                  <Text style={styles.castCharacter} numberOfLines={1}>{person.character}</Text>
                                </View>
                              ))}
                            </ScrollView>
                          </View>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* Movie overview */}
                    <Text style={styles.detailOverview}>
                      {detail.metadata?.overview || item.overview || "No synopsis is available."}
                    </Text>

                    {/* File quality info */}
                    {detail.file && (
                      <Text style={styles.detailQuality}>
                        {[
                          detail.file.height ? `${detail.file.height}p` : null,
                          (detail.file as any).videoCodec?.toUpperCase(),
                          (detail.file as any).hdr,
                          (detail.file as any).container?.toUpperCase(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    )}

                    {/* Movie Cast */}
                    {!!detail.cast?.length && (
                      <View style={{ gap: 12 }}>
                        <Text style={styles.detailSectionLabel}>Cast & Crew</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
                          {detail.cast.map((person: any, i: number) => (
                            <View key={`${person.name}-${i}`} style={styles.castCard}>
                              {person.photo ? (
                                <Image
                                  source={api.image(person.photo)}
                                  style={styles.castPhoto}
                                />
                              ) : (
                                <View style={[styles.castPhoto, styles.castPhotoPlaceholder]}>
                                  <Text style={styles.castInitial}>
                                    {person.name?.[0]?.toUpperCase()}
                                  </Text>
                                </View>
                              )}
                              <Text style={styles.castName} numberOfLines={2}>{person.name}</Text>
                              <Text style={styles.castCharacter} numberOfLines={1}>{person.character}</Text>
                            </View>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </>
                )}
              </View>
            </>
          )
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// EpisodeCard (thumbnail with centered play button, title, overview & download)
// ---------------------------------------------------------------------------
function EpisodeCard({
  ep,
  api,
  platform,
  play,
  download,
  item,
  onToggleWatched,
}: {
  ep: any;
  api: any;
  platform: any;
  play: (fileId: number) => void;
  download: (item: ItemCard, fileId: number) => void;
  item: ItemCard;
  onToggleWatched?: (ep: any) => void;
}) {
  const { downloads } = useClient();
  const downloadEntries = useDownloads();
  const [focused, setFocused] = useState(false);
  const watched = Boolean(ep.watch?.played);
  const hasProgress = Boolean(ep.watch?.position && !watched);
  const duration = ep.runtime ? `${ep.runtime}:00` : null;
  const progress =
    hasProgress && ep.watch?.duration
      ? Math.min(1, ep.watch.position / ep.watch.duration)
      : null;

  const dl = ep.fileId ? downloadEntries.find((d) => d.fileId === ep.fileId) : undefined;
  const dlPercent = dl && dl.expected ? Math.min(100, Math.round((dl.bytes / dl.expected) * 100)) : 0;

  // Clean redundant S01E01 / Season 1 Episode 1 prefixes
  const rawName = String(ep.name || "").trim();
  const cleanedTitle = rawName
    .replace(/^(?:S\d+[\s._-]*E\d+|Season\s*\d+\s*Episode\s*\d+|Episode\s*\d+)\s*[:·._-]?\s*/i, "")
    .trim();

  // Show only the episode title; falls back to Episode {number} if name was empty
  const epDisplayTitle = cleanedTitle || (ep.episodeNumber != null ? `Episode ${ep.episodeNumber}` : rawName);

  const epItem: ItemCard = {
    ...item,
    id: ep.id,
    name: ep.name || `Episode ${ep.episodeNumber}`,
    poster: ep.poster || item.poster,
    kind: "episode",
    seasonNumber: ep.seasonNumber,
    episodeNumber: ep.episodeNumber,
  };
  (epItem as any).seriesName = item.name;

  return (
    <Pressable
      onPress={() => ep.fileId && play(ep.fileId)}
      disabled={!ep.fileId}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.epCard,
        platform.tv && focused && styles.epCardFocused,
        pressed && { opacity: 0.8 },
      ]}
    >
      {/* Thumbnail with centered play button */}
      <View style={styles.epThumbWrap}>
        {ep.poster ? (
          <Image source={api.image(ep.poster)} style={styles.epThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.epThumb, styles.epThumbPlaceholder]} />
        )}

        {/* Center play icon button */}
        <View style={[styles.epPlayOverlay, platform.tv && focused && styles.epPlayOverlayFocused]}>
          <Play
            size={18}
            color={platform.tv && focused ? "#000" : "#fff"}
            fill={platform.tv && focused ? "#000" : "#fff"}
          />
        </View>

        {/* Duration badge */}
        {duration && (
          <View style={styles.epDuration}>
            <Text style={styles.epDurationText}>{duration}</Text>
          </View>
        )}

        {/* Progress bar on thumbnail */}
        {(progress !== null || watched) && (
          <View style={styles.epProgressBar}>
            <View
              style={[
                styles.epProgressFill,
                watched
                  ? styles.epProgressWatched
                  : { width: `${Math.round(progress! * 100)}%` },
              ]}
            />
          </View>
        )}
      </View>

      {/* Info: Title, 2-line description, and small Episode {number} at the bottom */}
      <View style={styles.epInfo}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <Text
            style={[styles.epTitle, { flex: 1 }, platform.tv && focused && { color: "#ffffff" }]}
            numberOfLines={1}
          >
            {epDisplayTitle}
          </Text>

          {/* Action buttons: Download state */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>

            {ep.fileId && !platform.tv && !platform.local && (
              dl ? (
                dl.state === "downloading" ? (
                  <View style={styles.epDlBadgeActive}>
                    <Download size={12} color={colors.brand} strokeWidth={2.4} />
                    <Text style={styles.epDlBadgeTextActive}>{dlPercent}%</Text>
                  </View>
                ) : dl.state === "queued" ? (
                  <View style={styles.epDlBadgeQueued}>
                    <Text style={styles.epDlBadgeTextQueued}>Queued</Text>
                  </View>
                ) : dl.state === "completed" ? (
                  <View style={styles.epDlBadgeCompleted}>
                    <Check size={13} color="#22c55e" strokeWidth={2.6} />
                  </View>
                ) : dl.state === "failed" ? (
                  <Pressable
                    onPress={() => downloads.retry(dl.id)}
                    style={styles.epDlBadgeFailed}
                    hitSlop={6}
                  >
                    <RefreshCw size={12} color="#ef4444" strokeWidth={2} />
                    <Text style={styles.epDlBadgeTextFailed}>Retry</Text>
                  </Pressable>
                ) : null
              ) : (
                <Pressable
                  onPress={() => download(epItem, ep.fileId!)}
                  style={({ pressed }) => [styles.epDownloadIconBtn, pressed && { opacity: 0.6 }]}
                  hitSlop={8}
                  accessibilityLabel="Download episode"
                >
                  <Download size={15} color={colors.muted} strokeWidth={1.8} />
                </Pressable>
              )
            )}
          </View>
        </View>

        {/* Live download bar under title if downloading */}
        {dl?.state === "downloading" && (
          <View style={{ height: 2, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden", marginTop: 2 }}>
            <View style={{ width: `${dlPercent}%`, height: "100%", backgroundColor: colors.brand }} />
          </View>
        )}

        <Text style={styles.epOverview} numberOfLines={2}>
          {ep.overview || "No description available."}
        </Text>
        {ep.episodeNumber != null && (
          <Text style={styles.epNumberBottom}>
            {`Episode ${ep.episodeNumber}`}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // --- Genre pill ---
  genrePill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  genrePillText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: "#fff",
    letterSpacing: 0.2,
  },

  // --- Hero ---
  heroContainer: {
    width: "100%",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 10,
    maxWidth: "100%",
  },
  heroContentTV: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    maxWidth: 500,
    gap: 6,
  },
  heroPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  heroTitle: {
    fontFamily: fonts.black,
    fontSize: 36,
    color: "#fff",
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  heroTitleTV: {
    fontSize: 20,
    lineHeight: 24,
  },
  heroSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
    letterSpacing: 0.1,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
  },
  heroMetaText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
  },
  heroMetaDot: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
  },
  heroLogo: {
    width: 240,
    height: 70,
    marginBottom: 8,
  },
  heroLogoTV: {
    width: 300,
    height: 90,
    marginBottom: 10,
  },
  heroOverview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(255,255,255,0.78)",
    marginTop: 4,
  },
  heroButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
    alignItems: "center",
  },
  heroPlayBtn: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 12,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroPlayBtnTV: {
    flex: 0,
    alignSelf: "flex-start",
    backgroundColor: colors.brand,
    minHeight: 44,
    paddingVertical: 10,
  },
  heroPlayBtnText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: "#000000",
    letterSpacing: 0.2,
  },
  heroPlayBtnTextTV: {
    color: "#ffffff",
  },
  heroIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconBtnWatched: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  heroIconBtnDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "rgba(239, 68, 68, 0.5)",
  },
  heroDetailsBtn: {
    flex: 0,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.6)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  heroDetailsBtnText: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    color: "#fff",
  },
  heroBtnDisabled: {
    opacity: 0.4,
  },
  heroBtnPressed: {
    opacity: 0.78,
  },
  // --- TV hero focus states ---
  heroSlideHeader: {
    borderRadius: 8,
    padding: 2,
  },
  heroSlideHeaderFocused: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginHorizontal: -8,
    marginVertical: -4,
  },
  heroMetaRating: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
  },
  heroFocusRing: {
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  heroPlayBtnFocused: {
    borderColor: "#ffffff",
    borderWidth: 2,
    zIndex: 3,
    elevation: 8,
  },
  heroIconBtnFocused: {
    borderColor: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.28)",
    zIndex: 3,
    elevation: 8,
  },
  iconBtnFocusRing: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: 16,
  },

  // --- Hero Carousel ---
  carouselDots: {
    position: "absolute",
    bottom: 10,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    zIndex: 10,
  },
  carouselDotsTV: {
    top: 18,
    bottom: undefined,
    right: 28,
    left: undefined,
    justifyContent: "flex-end",
  },
  carouselDot: {
    flex: 1,
    maxWidth: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  carouselDotActive: {
    backgroundColor: "#ffffff",
  },
  carouselDotFocused: {
    borderWidth: 1.5,
    borderColor: "#ffffff",
    transform: [{ scale: 1.2 }],
  },

  // --- Continue Watching Card ---
  cwCard: {
    width: 168,
    gap: 6,
  },
  cwCardFocused: {
    zIndex: 3,
    elevation: 8,
  },
  cwPreferred: {
    zIndex: 3,
    elevation: 8,
  },
  cwFocusRing: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2.5,
    borderColor: "#ffffff",
    borderRadius: 8,
    zIndex: 5,
  },
  cwThumbWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  cwThumb: {
    width: "100%",
    height: "100%",
  },
  cwThumbPlaceholder: {
    backgroundColor: colors.elevated,
  },
  cwBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  cwBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 9.5,
    color: "#fff",
  },
  cwDuration: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  cwDurationText: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    color: "#fff",
  },
  cwPlayCircle: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.8)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  cwProgressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  cwProgressFill: {
    height: "100%",
    backgroundColor: colors.brand,
  },
  cwInfo: {
    gap: 2,
  },
  cwTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 15,
    color: colors.ink,
  },
  cwSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 10.5,
    color: colors.muted,
  },

  // --- Catalog row ---
  rowContainer: {
    marginBottom: 20,
    gap: 6,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 2,
  },
  rowTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.3,
  },
  rowSeeAll: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
  },
  rowList: {
    paddingHorizontal: 20,
    gap: 10,
  },

  // --- Home ---
  homeContainer: {
    paddingBottom: 28,
  },
  homeRefresh: {
    paddingHorizontal: 20,
    paddingTop: 8,
    alignSelf: "flex-start",
  },

  // --- Library ---
  libraryRoot: {
    flex: 1,
    gap: 0,
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: colors.surface,
    maxWidth: 190,
  },
  sortButtonOpen: {
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: colors.elevated,
  },
  sortButtonText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.ink,
    flexShrink: 1,
  },
  libSegmentWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  libSegment: {
    flexDirection: "row",
    height: 46,
    padding: 3,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  libSegmentItem: {
    flex: 1,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  libSegmentItemActive: {
    backgroundColor: "#ffffff",
  },
  libSegmentText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
    letterSpacing: 0.1,
  },
  libSegmentTextActive: {
    fontFamily: fonts.bold,
    color: "#000000",
  },
  dlFilterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sortBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.66)",
  },
  sortSheet: {
    backgroundColor: "#0b0b0b",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  sortHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignSelf: "center",
    marginBottom: 10,
  },
  sortTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.3,
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  sortRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  sortRowActive: {
    backgroundColor: "#ffffff",
  },
  sortRowText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  sortRowTextActive: {
    fontFamily: fonts.bold,
    color: "#000000",
  },
  filterRow: {
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    minHeight: 38,
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  filterChipActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  filterChipText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    color: colors.muted,
  },
  filterChipTextActive: {
    color: "#000000",
    fontFamily: fonts.bold,
  },
  filterChipFocusedTv: {
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  filterChipTextFocusedTv: {
    fontFamily: fonts.bold,
  },
  libGrid: {
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 4,
  },

  // --- Search ---
  searchContainer: {
    paddingBottom: 32,
    gap: 14,
  },
  searchInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    minHeight: 46,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  searchInputWrapFocused: {
    borderColor: "rgba(255,255,255,0.36)",
    backgroundColor: colors.elevated,
  },
  searchInputWrapTv: {
    maxWidth: "100%",
    width: "100%",
    height: 38,
    alignSelf: "stretch",
    borderRadius: 10,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: colors.line,
  },
  searchInputWrapTvFocused: {
    borderColor: "#ffffff",
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 10,
  },
  searchInputTv: {
    fontSize: 13,
    paddingVertical: 0,
  },
  searchClear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  searchHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.muted,
    paddingHorizontal: 20,
  },
  searchGridSection: {
    gap: 12,
    paddingHorizontal: 20,
  },
  searchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },

  // --- Detail ---
  detailContainer: {
    paddingBottom: 48,
  },
  detailBack: {
    position: "absolute",
    top: 14,
    left: 16,
    zIndex: 99,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  detailBody: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 18,
  },
  detailBodyTV: {
    paddingHorizontal: 36,
  },
  detailMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  detailMetaText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.muted,
  },
  detailMetaDot: {
    color: colors.muted,
    fontSize: 13,
  },
  detailRating: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.amber,
  },
  detailPlayBtn: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  detailPlayBtnText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: "#fff",
    letterSpacing: 0.2,
  },
  detailActions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  detailActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  detailActionText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.ink,
  },
  detailOverview: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: "rgba(240,240,240,0.78)",
    lineHeight: 22,
  },
  detailQuality: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.quiet,
    letterSpacing: 0.3,
  },
  detailSectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  detailTabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 20,
    marginTop: 4,
    marginBottom: 6,
  },
  detailTabItem: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  detailTabItemActive: {
    borderBottomColor: "#ffffff",
  },
  detailTabItemText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.muted,
  },
  detailTabItemTextActive: {
    fontFamily: fonts.bold,
    color: colors.ink,
  },
  detailTabItemFocusedTv: {
    borderBottomWidth: 3,
    borderBottomColor: "#ffffff",
  },

  // Season pills
  seasonPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 50,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  seasonPillActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  seasonPillText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
  },
  seasonPillTextActive: {
    color: "#000000",
    fontFamily: fonts.bold,
  },
  seasonPillFocusedTv: {
    borderWidth: 2,
    borderColor: "#ffffff",
  },

  // Episode card
  epCard: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  epCardFocused: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.65)",
  },
  epThumbWrap: {
    width: 148,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  epThumb: {
    width: "100%",
    height: "100%",
  },
  epThumbPlaceholder: {
    backgroundColor: colors.elevated,
  },
  epBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  epBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: "#fff",
  },
  epDuration: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  epDurationText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: "#fff",
  },
  epProgressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  epProgressFill: {
    height: "100%",
    backgroundColor: colors.brand,
    borderRadius: 2,
  },
  epProgressWatched: {
    width: "100%",
    backgroundColor: colors.brand,
  },
  epDlBadgeActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,102,204,0.15)",
    borderWidth: 1,
    borderColor: colors.brand,
  },
  epDlBadgeTextActive: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.brand,
  },
  epDlBadgeQueued: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  epDlBadgeTextQueued: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
  },
  epDlBadgeCompleted: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: "rgba(34,197,94,0.15)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  epDlBadgeFailed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(239,68,68,0.15)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
  },
  epDlBadgeTextFailed: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: "#ef4444",
  },
  epWatchedToggleBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  epWatchedToggleBtnActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  seasonDownloadBar: {
    paddingVertical: 6,
  },
  downloadSeasonBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  downloadSeasonBtnActive: {
    borderColor: colors.brand,
    backgroundColor: "rgba(0,102,204,0.12)",
  },
  downloadSeasonBtnCompleted: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  downloadSeasonBtnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: "#ffffff",
  },
  downloadSeasonBtnTextActive: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.brand,
  },
  downloadSeasonBtnTextCompleted: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: "#22c55e",
  },
  epInfo: {
    flex: 1,
    gap: 6,
    justifyContent: "center",
  },
  epTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.ink,
  },
  epOverview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  epActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    alignItems: "center",
  },
  epPlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  epPlayBtnDisabled: {
    opacity: 0.4,
  },
  epPlayBtnText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: "#fff",
  },
  epPlayOverlay: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
    top: "50%",
    left: "50%",
    marginTop: -19,
    marginLeft: -19,
  },
  epPlayOverlayFocused: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  epNumberBottom: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: colors.muted,
    marginTop: 4,
  },
  epDownloadIconBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  epDownloadBtn: {
    padding: 6,
    backgroundColor: colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },

  // Cast
  castCard: {
    width: 96,
    gap: 6,
  },
  castPhoto: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  castPhotoPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  castInitial: {
    fontFamily: fonts.black,
    fontSize: 24,
    color: colors.muted,
  },
  castName: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 16,
  },
  castCharacter: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.muted,
  },

  // theme re-exports for inline use
  amber: {
    color: "#e8a33d",
  },
  elevated: {
    backgroundColor: "#1a1a1a",
  },
  quiet: {
    color: "#666666",
  },
});
