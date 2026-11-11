import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  AudioLines,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Home,
  Library,
  Maximize,
  Menu,
  Minimize,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Subtitles,
  Tv,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from "lucide-react-native";
import React, { forwardRef, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, {
  Defs,
  Path,
  Stop,
  LinearGradient as SvgGradient,
} from "react-native-svg";
import type { ItemCard, LocalCatalog } from "../lib/client/api";
import { colors, fonts } from "../ui/theme";
// ---------------------------------------------------------------------------
// Icon registry
// ---------------------------------------------------------------------------
export const icons = {
  back: ArrowLeft,
  audio: AudioLines,
  bell: Bell,
  check: Check,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  download: Download,
  film: Film,
  home: Home,
  library: Library,
  fullscreen: Maximize,
  menu: Menu,
  minimize: Minimize,
  panelLeftClose: PanelLeftClose,
  panelLeftOpen: PanelLeftOpen,
  pause: Pause,
  play: Play,
  search: Search,
  settings: Settings,
  rewind: SkipBack,
  forward: SkipForward,
  captions: Subtitles,
  tv: Tv,
  volume: Volume2,
  mute: VolumeX,
  close: X,
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof icons;
// ---------------------------------------------------------------------------
// PosterImage
// ---------------------------------------------------------------------------
import {
  getCachedImageSync,
  resolveCachedImage,
} from "../lib/client/image-cache";
export function PosterImage({
  source,
  style,
  resizeMode = "cover",
}: {
  source:
    | {
        uri: string;
        headers?: Record<string, string>;
      }
    | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
}) {
  const [resolvedUri, setResolvedUri] = useState<string | null>(() => {
    if (!source?.uri) return null;
    if (source.uri.startsWith("file://")) return source.uri;
    return getCachedImageSync(source.uri);
  });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastUri = useRef("");
  const uri = source?.uri || "";
  if (lastUri.current !== uri) {
    lastUri.current = uri;
    if (failed || attempt) {
      setFailed(false);
      setAttempt(0);
    }
  }
  useEffect(() => {
    if (!source?.uri) return;
    if (source.uri.startsWith("file://")) {
      setResolvedUri(source.uri);
      return;
    }
    const mem = getCachedImageSync(source.uri);
    if (mem) {
      setResolvedUri(mem);
      return;
    }
    let active = true;
    void resolveCachedImage(source.uri, source.headers).then((local) => {
      if (active && local && local !== source.uri) {
        setResolvedUri(local);
      }
    });
    return () => {
      active = false;
    };
  }, [source?.uri]);
  if (!source || failed) return null;
  const imageSource = resolvedUri ? { uri: resolvedUri } : source;
  return (
    <Image
      key={resolvedUri || String(attempt)}
      source={imageSource}
      style={[{ width: "100%", height: "100%" }, style]}
      resizeMode={resizeMode}
      onError={() => {
        if (attempt < 1) setAttempt((a) => a + 1);
        else setFailed(true);
      }}
    />
  );
}
// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------
export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const Component = icons[name];
  return <Component size={size} color={color} strokeWidth={1.7} />;
}
// ---------------------------------------------------------------------------
// PlexyMark / PlexyLogo
// ---------------------------------------------------------------------------
export function PlexyMark({ size = 22 }: { size?: number }) {
  const height = (size * 277) / 256;
  return (
    <Svg
      width={size}
      height={height}
      viewBox="0 0 256 277"
      style={{ overflow: "visible" }}
    >
      <Defs>
        <SvgGradient id="plexy__blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#6C9FFF" />
          <Stop offset="50%" stopColor="#3B7DF9" />
          <Stop offset="100%" stopColor="#1F4FCB" />
        </SvgGradient>
      </Defs>
      <Path
        fill="url(#plexy__blue)"
        d="M223.517 44.823 161.174 8.85a65.565 65.565 0 0 0-65.792 0l-62.63 35.973C12.642 56.623 0 78.495 0 101.806v72.235c0 23.6 12.641 45.183 32.752 56.982l62.343 36.263a65.565 65.565 0 0 0 65.791 0l62.343-36.263c20.399-11.799 32.752-33.383 32.752-56.982v-72.235c.575-23.311-12.066-45.183-32.464-56.983Zm-95.383 157.422c-35.337 0-64.067-28.78-64.067-64.177 0-35.399 28.73-64.178 64.067-64.178 35.338 0 64.355 28.779 64.355 64.178 0 35.398-28.73 64.177-64.355 64.177Z"
      />
    </Svg>
  );
}
export function PlexyLogo({
  size = 22,
  showText = true,
}: {
  size?: number;
  showText?: boolean;
}) {
  return (
    <View style={styles.logoRow}>
      <PlexyMark size={size} />
      {showText && (
        <Text
          style={{
            fontFamily: fonts.black,
            fontSize: size * 0.95,
            color: "#ffffff",
            letterSpacing: -0.4,
          }}
        >
          Plexy
        </Text>
      )}
    </View>
  );
}
// ---------------------------------------------------------------------------
// PageHeader — the one title treatment shared by every root screen.
// Titles only: no eyebrow labels, no subtitles, no decorative rules.
// ---------------------------------------------------------------------------
export function PageHeader({
  title,
  logo = false,
  right,
  style,
}: {
  title?: string;
  logo?: boolean;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.pageHeader, style]}>
      <View style={styles.pageHeaderTitleRow}>
        {logo ? (
          <>
            <PlexyMark size={24} />
            <Text accessibilityRole="header" style={styles.pageTitle}>
              Plexy
            </Text>
          </>
        ) : (
          <Text accessibilityRole="header" style={styles.pageTitle}>
            {title}
          </Text>
        )}
      </View>
      {right ? <View style={styles.pageHeaderRight}>{right}</View> : null}
    </View>
  );
}
// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------
export function Label({
  children,
  muted = false,
  style,
  numberOfLines,
  selectable,
}: React.PropsWithChildren<{
  muted?: boolean;
  style?: import("react-native").StyleProp<import("react-native").TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}>) {
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      style={[styles.text, muted && { color: colors.muted }, style]}
    >
      {children}
    </Text>
  );
}
// ---------------------------------------------------------------------------
// Heading
// ---------------------------------------------------------------------------
export function Heading({
  children,
  large = false,
}: React.PropsWithChildren<{
  large?: boolean;
}>) {
  return (
    <Label
      style={{
        fontFamily: fonts.black,
        fontSize: large ? 34 : 24,
        lineHeight: large ? 42 : 32,
        letterSpacing: -0.5,
      }}
    >
      {children}
    </Label>
  );
}
// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export const Button = forwardRef<
  View,
  {
    label: string;
    icon?: IconName;
    onPress: () => void;
    primary?: boolean;
    selected?: boolean;
    disabled?: boolean;
    compact?: boolean;
    preferred?: boolean;
    style?: StyleProp<ViewStyle>;
    onFocus?: () => void;
    testID?: string;
  }
>(function Button(
  {
    label,
    icon,
    onPress,
    primary,
    selected,
    disabled,
    compact,
    preferred,
    style,
    onFocus,
    testID,
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isFilled = primary || selected;
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        isFilled ? styles.buttonPrimary : styles.buttonSecondary,
        compact && styles.buttonCompact,
        focused && styles.buttonFocused,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={compact ? 18 : 20} color="#fff" />}
      {!compact && (
        <Label
          style={{
            color: "#fff",
            fontFamily: fonts.medium,
            fontSize: 15,
          }}
        >
          {label}
        </Label>
      )}
    </Pressable>
  );
});
// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------
export function Notice({
  message,
  retry,
  kind = "info",
}: {
  message: string;
  retry?: () => void;
  kind?: "info" | "error";
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Label style={{ color: kind === "error" ? colors.danger : colors.ink }}>
        {message}
      </Label>
      {retry && <Button label="Retry" onPress={retry} />}
    </View>
  );
}
// ---------------------------------------------------------------------------
// ToggleSwitch — one consistent switch for the whole app
// ---------------------------------------------------------------------------
export function ToggleSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 20],
  });
  const backgroundColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(255, 255, 255, 0.16)", "#ffffff"],
  });
  const thumbColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#a1a1aa", "#000000"],
  });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        {
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Animated.View
        style={{
          width: 44,
          height: 26,
          borderRadius: 13,
          backgroundColor,
          justifyContent: "center",
          borderWidth: 1,
          borderColor: value
            ? "rgba(255, 255, 255, 0.8)"
            : "rgba(255, 255, 255, 0.12)",
        }}
      >
        <Animated.View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: thumbColor,
            transform: [{ translateX }],
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.3,
            shadowRadius: 2,
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
// ---------------------------------------------------------------------------
// Loading — quiet logo lockup with an indeterminate hairline.
// ---------------------------------------------------------------------------
export function Loading({
  showLogo,
}: {
  showLogo?: boolean;
} = {}) {
  const shouldShowLogo = showLogo !== undefined ? showLogo : true;
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shouldShowLogo) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(slide, {
          toValue: 1,
          duration: 1150,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shouldShowLogo, slide]);
  if (!shouldShowLogo) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator
          size="small"
          color="#ffffff"
          accessibilityLabel="Loading"
        />
      </View>
    );
  }
  return (
    <View style={styles.loadingWrap}>
      <PlexyLogo size={34} showText={true} />
      <View style={styles.loadingTrack} accessibilityLabel="Loading">
        <Animated.View
          style={[
            styles.loadingBar,
            {
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 92],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}
// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  item,
  api,
  onPress,
  preferred,
  onFocus,
  width,
}: {
  item: ItemCard;
  api: LocalCatalog;
  onPress: () => void;
  preferred?: boolean;
  onFocus?: () => void;
  width?: number;
}) {
  const [focus, setFocus] = useState(false);
  const isEpisode = item.kind === "episode";
  const aspectRatio = isEpisode ? 16 / 9 : 2 / 3;
  const cardWidth = width || 150;
  const hasProgress = !!item.watch && !item.watch.played;
  const isWatched = item.watch?.played;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.parentTitle ? item.parentTitle + ", " : ""}${item.name}${isWatched ? ", watched" : ""}`}
      onFocus={() => {
        setFocus(true);
        onFocus?.();
      }}
      onBlur={() => setFocus(false)}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: cardWidth,
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {/* Image container */}
      <View
        style={[
          styles.cardImageWrap,
          { aspectRatio },
          focus && styles.cardImageFocusedTv,
        ]}
      >
        {/* Poster placeholder */}
        <View style={styles.cardPlaceholder} pointerEvents="none">
          <Icon
            name={item.kind === "series" ? "tv" : "film"}
            size={40}
            color={colors.quiet}
          />
        </View>
        {/* Poster / thumbnail */}
        <PosterImage source={api.image(item.poster)} />
        {/* White focus ring when selected */}

        {/* Bottom gradient overlay */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          style={styles.cardGradient}
          pointerEvents="none"
        />

        {/* Episode badge: E1 and duration chip on top-left (as in reference screenshots) */}
        {isEpisode && (
          <View style={styles.cardChipRow}>
            {item.episodeNumber != null && (
              <View style={styles.cardChip}>
                <Text style={styles.cardChipText}>E{item.episodeNumber}</Text>
              </View>
            )}
            {!!item.runtime && (
              <View style={styles.cardChip}>
                <Text style={styles.cardChipText}>{item.runtime}:00</Text>
              </View>
            )}
          </View>
        )}

        {/* Title overlay at bottom */}
        <View style={styles.cardTitleOverlay} pointerEvents="none">
          <Text numberOfLines={2} style={styles.cardOverlayTitle}>
            {item.parentTitle ? `${item.parentTitle}: ${item.name}` : item.name}
          </Text>
        </View>

        {/* Circular progress ring at bottom-right */}
        {hasProgress && (
          <View style={styles.cardProgressRing}>
            <View style={styles.cardProgressRingInner} />
          </View>
        )}

        {/* Progress bar */}
        {hasProgress && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${item.watch!.percent}%` },
              ]}
            />
          </View>
        )}

        {/* Watched badge */}
        {isWatched && (
          <View style={styles.watchedBadge}>
            <Check size={10} color="#fff" strokeWidth={2.5} />
          </View>
        )}
      </View>

      {/* Below-image meta */}
      <Label
        muted
        numberOfLines={1}
        style={{ fontSize: 11, fontFamily: fonts.medium }}
      >
        {isEpisode
          ? `Episode ${item.episodeNumber || 1}`
          : item.year || (item.kind === "series" ? "Series" : "Movie")}
      </Label>
    </Pressable>
  );
}
// ---------------------------------------------------------------------------
// TabBar
// ---------------------------------------------------------------------------
export type TabDef = {
  key: string;
  label: string;
  icon: IconName;
};
const styles = StyleSheet.create({
  // --- Logo ---
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // --- Page header ---
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    minHeight: 64,
  },
  pageHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  pageTitle: {
    fontFamily: fonts.black,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.9,
    color: colors.ink,
  },
  pageHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // --- Text ---
  text: {
    fontFamily: fonts.regular,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  // --- Button ---
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    minHeight: 46,
  },
  buttonPrimary: {
    backgroundColor: colors.brand,
    borderRadius: 100, // pill
  },
  buttonSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 10,
  },
  buttonCompact: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 36,
  },
  buttonFocused: {
    borderWidth: 2,
    borderColor: "#fff",
  },
  // --- Notice ---
  notice: {
    padding: 16,
    backgroundColor: colors.elevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 14,
    marginVertical: 12,
  },
  // --- Loading ---
  loadingWrap: {
    flex: 1,
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 26,
  },
  loadingTrack: {
    width: 140,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  loadingBar: {
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#ffffff",
  },
  // --- Card ---
  cardImageWrap: {
    backgroundColor: colors.elevated,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  cardImageFocusedTv: {
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  cardPlaceholder: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  cardGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
  },
  cardTitleOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    paddingHorizontal: 10,
  },
  cardOverlayTitle: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: "#fff",
    lineHeight: 16,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.brand,
  },
  cardChipRow: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    gap: 5,
    zIndex: 2,
  },
  cardChip: {
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  cardChipText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: fonts.bold,
  },
  cardProgressRing: {
    position: "absolute",
    right: 8,
    bottom: 12,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    borderTopColor: colors.brand,
    borderRightColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  cardProgressRingInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand,
  },
  watchedBadge: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
export function dicebearAvatarUrl(seed: string): string {
  const clean = encodeURIComponent((seed || "user").trim());
  return `https://api.dicebear.com/9.x/bottts-neutral/png?seed=${clean}&size=128`;
}
export function UserAvatar({
  name,
  size = 32,
  style,
}: {
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [loadError, setLoadError] = useState(false);
  const initial = (name || "U").charAt(0).toUpperCase();
  const avatarUrl = dicebearAvatarUrl(name);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: "#1f1f23",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(255, 255, 255, 0.15)",
        },
        style,
      ]}
    >
      {!loadError ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
          onError={() => setLoadError(true)}
        />
      ) : (
        <Text
          style={{
            fontSize: Math.round(size * 0.42),
            fontWeight: "700",
            color: "#ffffff",
            fontFamily: fonts.bold,
          }}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}
