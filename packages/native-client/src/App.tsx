import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  useFonts,
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_700Bold,
  Archivo_900Black,
} from "@expo-google-fonts/archivo";
import { Connect } from "./Connect";
import { ClientProvider, useClient, useDownloads, type NativePlatform } from "./context";
import { sessionStore } from "./storage";
import { type Session, type ItemCard } from "./api";
import { Button, Heading, Icon, Label, Loading, Notice, PlexyLogo, UserAvatar, type IconName } from "./ui";
import {
  HomeScreen,
  LibraryScreen,
  SearchScreen,
  DetailScreen,
} from "./Catalog";
import { DownloadsScreen, DownloadPicker } from "./DownloadsScreen";
import { SettingsScreen } from "./Settings";
import { PlayerScreen } from "./Player";
import type { DownloadEntry } from "./downloads";
import { colors } from "./theme";

// ─── Tab types ────────────────────────────────────────────────────────────────

type MobileTab = "home" | "libraries" | "downloads" | "search" | "settings";
type TvTab = "home" | "movies" | "tv" | "downloads" | "search" | "settings";
type Tab = MobileTab | TvTab;

type Route =
  | { key: number; type: "detail"; id: string | number }
  | { key: number; type: "downloads" }
  | { key: number; type: "player"; fileId: number; offline?: DownloadEntry };

// ─── Tab definitions ──────────────────────────────────────────────────────────

const mobileTabs: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "libraries", label: "Libraries", icon: "library" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "search", label: "Search", icon: "search" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const tvTabs: Array<{ id: TvTab; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "movies", label: "Movies", icon: "film" },
  { id: "tv", label: "TV Shows", icon: "tv" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "search", label: "Search", icon: "search" },
  { id: "settings", label: "Settings", icon: "settings" },
];

// ─── Page Transition ──────────────────────────────────────────────────────────

function PageTransition({
  visible,
  children,
  isDetail = false,
}: {
  visible: boolean;
  children: React.ReactNode;
  isDetail?: boolean;
}) {
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: isDetail ? 240 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible, isDetail, anim]);

  return (
    <Animated.View
      style={{
        flex: 1,
        display: visible ? "flex" : "none",
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [isDetail ? 16 : 8, 0],
            }),
          },
        ],
      }}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      {children}
    </Animated.View>
  );
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const BRAND_BLUE = "#3B7DF9";
const TAB_BAR_BG = "#0d0d0d";
const TAB_BAR_BORDER = "#1a1a1a";
const INACTIVE_COLOR = "#666666";
const ACTIVE_COLOR = "#ffffff";
const TAB_BAR_HEIGHT = 56;
const TV_SIDEBAR_WIDTH = 220;

// ── TV sidebar item ─────────────────────────────────────────────────────────
function TvSidebarItem({
  item,
  isActive,
  onPress,
}: {
  item: { id: Tab; label: string; icon: IconName };
  isActive: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const showWhite = isActive;

  return (
    <Pressable
      key={item.id}
      hasTVPreferredFocus={isActive}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tvNavItem,
        showWhite && styles.tvNavItemActive,
        focused && !showWhite && styles.tvNavItemFocused,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icon
        name={item.icon}
        size={20}
        color={showWhite ? "#000000" : focused ? "#ffffff" : INACTIVE_COLOR}
      />
      <Text
        style={[
          styles.tvNavLabel,
          showWhite
            ? styles.tvNavLabelActive
            : focused
              ? styles.tvNavLabelFocused
              : styles.tvNavLabelInactive,
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export function NativeApp({ platform }: { platform: NativePlatform }) {
  const [session, setSession] = useState<Session | null>(null);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });

  useEffect(() => {
    void sessionStore
      .load()
      .then(setSession)
      .catch(() =>
        setBootError(
          "Could not load your saved session. Reconnect to your server.",
        ),
      )
      .finally(() => setBooted(true));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        {!booted || (!fontsLoaded && !fontError) ? (
          <Loading />
        ) : !session || connecting ? (
          <SafeAreaView style={{ flex: 1 }}>
            {!!bootError && <Notice message={bootError} />}
            <Connect
              tv={platform.tv}
              onCancel={session ? () => setConnecting(false) : undefined}
              onConnected={(value) => {
                setSession(value);
                setConnecting(false);
                setBootError("");
              }}
            />
          </SafeAreaView>
        ) : (
          <ClientProvider
            key={`${session.profile.id}:${session.profile.url}`}
            session={session}
            platform={platform}
          >
            <Shell
              connect={() => setConnecting(true)}
              signedOut={() => setSession(null)}
              sessionChanged={setSession}
            />
          </ClientProvider>
        )}
      </View>
    </SafeAreaProvider>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function Shell({
  connect,
  signedOut,
  sessionChanged,
}: {
  connect: () => void;
  signedOut: () => void;
  sessionChanged: (session: Session) => void;
}) {
  const {
    platform,
    session,
    api,
    downloads,
    progress,
    ready,
    storageError,
    cachedCatalog,
  } = useClient();

  const isTv = platform.tv;
  const defaultTab: Tab = "home";

  const [tab, setTab] = useState<Tab>(defaultTab);
  const [visited, setVisited] = useState<Set<Tab>>(new Set([defaultTab]));
  const [routes, setRoutes] = useState<Route[]>([]);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [picker, setPicker] = useState<{
    item: ItemCard;
    fileId: number;
  } | null>(null);

  const current = routes[routes.length - 1];

  const downloadEntries = useDownloads();
  const activeDownloads = downloadEntries.filter(
    (e) => e.state === "downloading" || e.state === "queued",
  );

  const back = React.useCallback(
    () => setRoutes((previous) => previous.slice(0, -1)),
    [],
  );

  const open = (id: string | number) =>
    setRoutes((previous) => [
      ...previous,
      { type: "detail", id, key: Date.now() },
    ]);

  const openDownloads = () => {
    if (!isTv) {
      switchTab("downloads");
    } else {
      setRoutes((previous) => [
        ...previous,
        { type: "downloads", key: Date.now() },
      ]);
    }
  };

  const play = (fileId: number, offline?: DownloadEntry) =>
    setRoutes((previous) => [
      ...previous,
      { type: "player", fileId, offline, key: Date.now() },
    ]);

  const next = React.useCallback(
    (fileId: number) =>
      setRoutes((previous) => [
        ...previous.slice(0, -1),
        { type: "player", fileId, key: Date.now() },
      ]),
    [],
  );

  useEffect(() => {
    if (current?.type === "player") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picker) {
        setPicker(null);
        return true;
      }
      if (routes.length) {
        back();
        return true;
      }
      if (tab !== "home") {
        setTab("home");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [current?.type, routes.length, picker, tab, back]);

  async function signout(remove: boolean) {
    await downloads.dispose();
    if (remove) await downloads.clear();
    await progress.flush(api).catch(() => {});
    await api.logout().catch(() => {});
    await sessionStore.remove(session.profile.id);
    signedOut();
  }

  const switchTab = (id: Tab) => {
    setTab(id);
    setVisited((previous) => new Set([...previous, id]));
    setRoutes([]);
  };

  if (storageError)
    return (
      <View style={{ padding: 24 }}>
        <Notice message={storageError} />
        <Button label="Reconnect" onPress={connect} />
      </View>
    );

  if (!ready) return <Loading />;

  const FocusGroup = platform.FocusGroup;
  const activeTabs = isTv ? tvTabs : mobileTabs;
  const displayUsername = session.profile.username || session.profile.name || "User";

  // ── Screen renderer ─────────────────────────────────────────────────────────
  const renderScreen = (screen: Tab) => {
    if (screen === "home") {
      return (
        <HomeScreen
          open={open}
          play={play}
          focusId={focusId}
          focused={setFocusId}
          active={!current && tab === "home"}
        />
      );
    }
    if (screen === "libraries") {
      return (
        <LibraryScreen
          kind="series"
          open={open}
          openDownloads={openDownloads}
        />
      );
    }
    if (screen === "movies") {
      return <LibraryScreen kind="movie" open={open} />;
    }
    if (screen === "tv") {
      return <LibraryScreen kind="series" open={open} />;
    }
    if (screen === "downloads") {
      return (
        <DownloadsScreen
          back={() => switchTab("home")}
          play={(entry) => play(entry.fileId, entry)}
        />
      );
    }
    if (screen === "search") {
      return <SearchScreen open={open} play={play} />;
    }
    if (screen === "settings") {
      return (
        <SettingsScreen
          connect={connect}
          signout={signout}
          sessionChanged={sessionChanged}
        />
      );
    }
    return null;
  };

  // ── TV sidebar ───────────────────────────────────────────────────────────────
  const tvSidebar = (
    <FocusGroup style={styles.tvSidebar}>
      {/* Branding */}
      <View style={styles.tvBrandRow}>
        <Text style={styles.tvBrandText}>Plexy</Text>
      </View>

      {/* Nav items */}
      <View style={styles.tvNavItems}>
        {(activeTabs as typeof tvTabs).map((item) => {
          const isActive = tab === item.id;
          return (
            <TvSidebarItem
              key={item.id}
              item={item}
              isActive={isActive}
              onPress={() => switchTab(item.id)}
            />
          );
        })}
      </View>

      {/* User info at bottom */}
      <View style={styles.tvUserRow}>
        <UserAvatar name={displayUsername} size={32} />
        <Text style={styles.tvUserName} numberOfLines={1}>
          {displayUsername}
        </Text>
      </View>
    </FocusGroup>
  );

  // ── Mobile header (home tab only) ────────────────────────────────────────────
  const mobileHeader = tab === "home" && !current && (
    <View style={styles.mobileHeader}>
      <PlexyLogo size={22} showText={true} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Downloads"
          onPress={openDownloads}
          style={styles.mobileHeaderBtn}
        >
          <Icon name="download" size={18} color="rgba(255,255,255,0.85)" />
          {activeDownloads.length > 0 && (
            <View style={styles.downloadBadge}>
              <Text style={styles.downloadBadgeText}>{activeDownloads.length}</Text>
            </View>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => switchTab("settings")}
          style={{ padding: 2 }}
        >
          <UserAvatar name={displayUsername} size={32} />
        </Pressable>
      </View>
    </View>
  );

  // ── Mobile bottom tab bar ────────────────────────────────────────────────────
  const MobileTabBar = () => {
    const insets = useSafeAreaInsets();
    const bottomPadding = Math.max(insets.bottom, 6);
    return (
      <View
        style={[
          styles.tabBar,
          {
            paddingBottom: bottomPadding,
            height: 58 + bottomPadding,
          },
        ]}
      >
        {(activeTabs as typeof mobileTabs).map((item) => {
          const isActive = tab === item.id;
          const isDownloads = item.id === "downloads";
          const showBadge = isDownloads && activeDownloads.length > 0;

          return (
            <Pressable
              key={item.id}
              onPress={() => switchTab(item.id)}
              android_ripple={{ borderless: true, color: "rgba(255, 255, 255, 0.15)" }}
              style={({ pressed }) => [
                styles.tabItem,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
            >
              <View
                style={[
                  styles.tabIconWrap,
                  isActive && styles.tabIconWrapActive,
                ]}
              >
                <Icon
                  name={item.icon}
                  size={20}
                  color={isActive ? "#000000" : INACTIVE_COLOR}
                />
                {showBadge && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{activeDownloads.length}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: isActive ? "#ffffff" : INACTIVE_COLOR,
                    fontFamily: isActive ? "Archivo_700Bold" : "Archivo_500Medium",
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView
        edges={isTv ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}
        style={[
          styles.safeArea,
          {
            flexDirection: isTv ? "row" : "column",
            display: current?.type === "player" ? "none" : "flex",
          },
        ]}
      >
        {/* TV: left sidebar */}
        {isTv && tvSidebar}

        {/* Main content area */}
        <View
          style={[
            styles.contentArea,
            isTv && styles.contentAreaTv,
          ]}
        >
          {/* Mobile: contextual header */}
          {!isTv && mobileHeader}

          {/* Offline catalog banner */}
          {cachedCatalog && (
            <Label muted style={{ padding: 12 }}>
              Offline catalog. Connect to refresh your library, or open
              Downloads to play saved media.
            </Label>
          )}

          {/* Tab screens (kept mounted once visited with smooth page transition) */}
          {[...visited].map((screen) => {
            const isVisible = screen === tab && !current;
            return (
              <PageTransition
                key={screen}
                visible={isVisible}
              >
                <FocusGroup style={{ flex: 1 }}>
                  {renderScreen(screen)}
                </FocusGroup>
              </PageTransition>
            );
          })}

          {/* Detail screens */}
          {routes
            .filter((route) => route.type === "detail")
            .map(
              (route) =>
                route.type === "detail" && (
                  <PageTransition
                    key={route.key}
                    visible={route === current}
                    isDetail={true}
                  >
                    <DetailScreen
                      id={route.id}
                      back={back}
                      play={(id) => play(id)}
                      download={(item, fileId) => setPicker({ item, fileId })}
                    />
                  </PageTransition>
                ),
            )}

          {/* Downloads screen */}
          {routes
            .filter((route) => route.type === "downloads")
            .map(
              (route) =>
                route.type === "downloads" && (
                  <PageTransition
                    key={route.key}
                    visible={route === current}
                    isDetail={true}
                  >
                    <DownloadsScreen
                      back={back}
                      play={(entry) => play(entry.fileId, entry)}
                    />
                  </PageTransition>
                ),
            )}
        </View>

        {/* Mobile: bottom tab bar */}
        {!isTv && <MobileTabBar />}
      </SafeAreaView>

      {/* Player overlay */}
      {current?.type === "player" && (
        <View key={current.key} style={StyleSheet.absoluteFill}>
          <PlayerScreen
            fileId={current.fileId}
            offline={current.offline}
            back={back}
            next={next}
          />
        </View>
      )}

      {/* Download picker modal */}
      {picker && (
        <DownloadPicker
          item={picker.item}
          fileId={picker.fileId}
          close={() => setPicker(null)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  contentArea: {
    flex: 1,
  },
  contentAreaTv: {
    borderLeftWidth: 1,
    borderColor: colors.line,
  },

  // ── Mobile header ────────────────────────────────────────────────────────────
  mobileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.canvas,
  },
  mobileHeaderOriginal: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: "Archivo_400Regular",
  },
  mobileHeaderBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BRAND_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: BRAND_BLUE,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  downloadBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Archivo_700Bold",
  },
  mobileAvatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: ACTIVE_COLOR,
    fontFamily: "Archivo_700Bold",
  },

  // ── Mobile bottom tab bar ─────────────────────────────────────────────────
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#08080a",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  tabItem: {
    flex: 1,
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 3,
    gap: 3,
  },
  tabIconWrap: {
    minWidth: 54,
    height: 32,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  tabIconWrapActive: {
    backgroundColor: "#ffffff",
  },
  tabBadge: {
    position: "absolute",
    top: -4,
    right: 2,
    backgroundColor: BRAND_BLUE,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Archivo_700Bold",
  },
  tabLabel: {
    fontSize: 10.5,
    letterSpacing: 0.1,
    textAlign: "center",
  },

  // ── TV sidebar ────────────────────────────────────────────────────────────
  tvSidebar: {
    width: TV_SIDEBAR_WIDTH,
    backgroundColor: "#0a0a0a",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: TAB_BAR_BORDER,
    paddingVertical: 24,
    justifyContent: "space-between",
  },
  tvBrandRow: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  tvBrandText: {
    fontSize: 24,
    fontWeight: "900",
    color: ACTIVE_COLOR,
    letterSpacing: -0.5,
    fontFamily: "Archivo_900Black",
  },
  tvNavItems: {
    flex: 1,
    gap: 4,
    paddingHorizontal: 12,
  },
  tvNavItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  tvNavItemActive: {
    backgroundColor: "#ffffff",
  },
  tvNavItemFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  tvNavLabel: {
    fontSize: 15,
    letterSpacing: 0.1,
  },
  tvNavLabelActive: {
    color: "#000000",
    fontWeight: "700",
    fontFamily: "Archivo_700Bold",
  },
  tvNavLabelFocused: {
    color: "#ffffff",
    fontWeight: "600",
    fontFamily: "Archivo_500Medium",
  },
  tvNavLabelInactive: {
    color: INACTIVE_COLOR,
    fontWeight: "400",
    fontFamily: "Archivo_400Regular",
  },
  tvUserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  tvAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BRAND_BLUE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tvAvatarText: {
    fontSize: 14,
    fontWeight: "700",
    color: ACTIVE_COLOR,
    fontFamily: "Archivo_700Bold",
  },
  tvUserName: {
    fontSize: 13,
    color: INACTIVE_COLOR,
    fontFamily: "Archivo_400Regular",
    flex: 1,
  },
});
