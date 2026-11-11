import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  ToastAndroid,
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
import { ClientProvider, useClient, useDownloads, type NativePlatform } from "../../../../packages/native-client/src/context";
import { sessionStore } from "../../../../packages/native-client/src/storage";
import { type Session, type ItemCard } from "../../../../packages/native-client/src/api";
import { Button, Heading, Icon, Label, Loading, Notice, UserAvatar, type IconName } from "../components/ui";
import {
  HomeScreen,
  LibraryScreen,
  SearchScreen,
  DetailScreen,
} from "./Catalog";
import { DownloadPicker } from "./DownloadsScreen";
import { SettingsScreen } from "./Settings";
import { PlayerScreen } from "./Player";
import { triggerHaptic } from "../../../../packages/native-client/src/haptics";
import type { DownloadEntry } from "../../../../packages/native-client/src/downloads";
import { colors } from "../ui/theme";
import { localSession } from "../../../../packages/native-client/src/local-api";

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = "home" | "libraries" | "search" | "settings";

type Route =
  | { key: number; type: "detail"; id: string | number }
  | { key: number; type: "player"; fileId: number; offline?: DownloadEntry };

// ─── Tab definitions ──────────────────────────────────────────────────────────

const mobileTabs: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "libraries", label: "Libraries", icon: "library" },
  { id: "search", label: "Search", icon: "search" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const tvTabs: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "libraries", label: "Libraries", icon: "library" },
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
  const isTv = Platform.isTV;
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (isTv) {
        anim.setValue(1);
        return;
      }
      // Start from the incoming edge so a pushed page reads as arriving,
      // not as a hard cut that pops over the tab.
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: isDetail ? 240 : 170,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();
    } else {
      if (isTv) {
        anim.setValue(0);
        setMounted(false);
        return;
      }
      Animated.timing(anim, {
        toValue: 0,
        duration: isDetail ? 150 : 120,
        easing: Easing.bezier(0.4, 0, 1, 1),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, isDetail, anim, isTv]);

  if (!mounted && !visible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        !isTv && {
          opacity: anim,
          transform: [
            {
              translateX: isDetail
                ? anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [34, 0],
                  })
                : 0,
            },
          ],
        },
      ]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      pointerEvents={visible ? "auto" : "none"}
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
const TV_SIDEBAR_WIDTH = 210;

function TvSidebarItem({
  item,
  isActive,
  onPress,
  onFocus,
  collapsed,
}: {
  item: { id: Tab; label: string; icon: IconName };
  isActive: boolean;
  onPress: () => void;
  onFocus?: () => void;
  collapsed?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const showWhite = isActive;

  return (
    <Pressable
      key={item.id}
      hasTVPreferredFocus={item.id === "home"}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      style={({ pressed }) => [
        collapsed ? styles.tvNavItemCollapsed : styles.tvNavItem,
        showWhite && (collapsed ? styles.tvNavItemCollapsedActive : styles.tvNavItemActive),
        focused && !showWhite && (collapsed ? styles.tvNavItemCollapsedFocused : styles.tvNavItemFocused),
        focused && { transform: [{ scale: 1.06 }] },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icon
        name={item.icon}
        size={collapsed ? 18 : 16}
        color={showWhite ? "#000000" : focused ? "#ffffff" : INACTIVE_COLOR}
      />
      {!collapsed && (
        <Text
          numberOfLines={1}
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
      )}
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
    if (platform.local) {
      void platform.local.restore().then(() => setSession(localSession))
        .catch((e) => setBootError(String(e))).finally(() => setBooted(true));
      return;
    }
    void sessionStore
      .load()
      .then(setSession)
      .catch(() =>
        setBootError(
          "Could not load your saved session. Reconnect to your server.",
        ),
      )
      .finally(() => setBooted(true));
  }, [platform]);

  useEffect(() => {
    if (!platform.local || !session) return;
    const refresh = () => { if (AppState.currentState !== "background" && AppState.currentState !== "inactive") void platform.local!.refresh().catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 5 * 60_000);
    const state = AppState.addEventListener("change", s => { if (s === "active") refresh(); });
    return () => { clearInterval(timer); state.remove(); };
  }, [platform, session]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        {!booted || (!fontsLoaded && !fontError) ? (
          <Loading />
        ) : platform.local && !session ? (
          <Notice message={bootError || "The local library could not be opened. Restart the app to retry."} />
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
    isOnline,
    checkConnection,
  } = useClient();

  const isTv = platform.tv;
  const insets = useSafeAreaInsets();
  const defaultTab: Tab = platform.local?.needsSetup() ? "settings" : "home";

  const [tab, setTab] = useState<Tab>(defaultTab);
  const [visited, setVisited] = useState<Set<Tab>>(new Set([defaultTab]));
  const [routes, setRoutes] = useState<Route[]>([]);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [picker, setPicker] = useState<{
    item: ItemCard;
    fileId: number;
  } | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);
  const [attentionCount, setAttentionCount] = useState(0);
  const [attentionFingerprint, setAttentionFingerprint] = useState("");
  const [dismissedFingerprint, setDismissedFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (!platform.local?.subscribe) return;
    const update = () => {
      const count = platform.local?.getAttentionCount?.() ?? 0;
      const fp = platform.local?.getAttentionFingerprint?.() ?? "";
      setAttentionCount(count);
      setAttentionFingerprint(fp);
    };
    update();
    return platform.local.subscribe(update);
  }, [platform.local]);

  const current = routes[routes.length - 1];

  const downloadEntries = useDownloads();
  const activeDownloads = downloadEntries.filter(
    (e) => e.state === "downloading" || e.state === "queued",
  );
  const completedDownloads = downloadEntries.filter(
    (e) => e.state === "completed" || Boolean(e.uri),
  );
  const hasCompletedDownloads = completedDownloads.length > 0;

  const handleRetryConnection = async () => {
    setCheckingConnection(true);
    try {
      await checkConnection();
    } finally {
      setCheckingConnection(false);
    }
  };

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
      switchTab("libraries");
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

  const lastBackPress = useRef(0);

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
        switchTab("home");
        return true;
      }
      if (isTv) {
        return true;
      }
      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        return false;
      }
      lastBackPress.current = now;
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [current?.type, routes.length, picker, tab, back, isTv]);

  async function signout(remove: boolean) {
    await downloads.dispose();
    if (remove) await downloads.clear();
    await progress.flush(api).catch(() => {});
    await api.logout().catch(() => {});
    await sessionStore.remove(session.profile.id);
    signedOut();
  }

  const switchTab = (id: Tab) => {
    triggerHaptic("selection");
    if (id === "home") {
      setFocusId(null);
    }
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
          kind="movie"
          open={open}
          openDownloads={openDownloads}
        />
      );
    }
    if (screen === "search") {
      return <SearchScreen open={open} play={play} />;
    }
    if (screen === "settings") {
      if (platform.local) {
        const LocalSettings = platform.local.Settings;
        return <LocalSettings />;
      }
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
    <FocusGroup style={[styles.tvSidebar, sidebarCollapsed && styles.tvSidebarCollapsed]}>
      {/* Branding & Collapse/Expand Toggle */}
      <View style={[styles.tvBrandRow, sidebarCollapsed && styles.tvBrandRowCollapsed]}>
        {!sidebarCollapsed && <Text style={styles.tvBrandText}>Plexy</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
          onPress={() => setSidebarCollapsed((c) => !c)}
          onFocus={() => setToggleFocused(true)}
          onBlur={() => setToggleFocused(false)}
          style={({ pressed }) => [
            styles.tvSidebarToggle,
            sidebarCollapsed && styles.tvSidebarToggleCollapsed,
            toggleFocused && styles.tvSidebarToggleFocused,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Icon
            name={sidebarCollapsed ? "panelLeftOpen" : "panelLeftClose"}
            size={16}
            color={toggleFocused ? "#ffffff" : "rgba(255, 255, 255, 0.75)"}
          />
        </Pressable>
      </View>

      {/* Nav items */}
      <View style={[styles.tvNavItems, sidebarCollapsed && styles.tvNavItemsCollapsed]}>
        {(activeTabs as typeof tvTabs).map((item) => {
          const isActive = tab === item.id;
          return (
            <TvSidebarItem
              key={item.id}
              item={item}
              isActive={isActive}
              collapsed={sidebarCollapsed}
              onPress={() => switchTab(item.id)}
              onFocus={() => {
                if (item.id === "home") {
                  setFocusId(null);
                }
              }}
            />
          );
        })}
      </View>

      {/* User info at bottom */}
      <View style={[styles.tvUserRow, sidebarCollapsed && styles.tvUserRowCollapsed]}>
        <UserAvatar name={displayUsername} size={sidebarCollapsed ? 26 : 28} />
        {!sidebarCollapsed && (
          <Text style={styles.tvUserName} numberOfLines={1}>
            {displayUsername}
          </Text>
        )}
      </View>
    </FocusGroup>
  );

  // ── Mobile bottom tab bar ────────────────────────────────────────────────────
  const MobileTabBar = () => {
    const bottomPadding = Math.max(insets.bottom, 8);
    return (
      <View
        style={[
          styles.tabBar,
          {
            paddingBottom: bottomPadding,
            height: 74 + bottomPadding,
          },
        ]}
      >
        {(activeTabs as typeof mobileTabs).map((item) => {
          const isActive = tab === item.id;

          return (
            <Pressable
              key={item.id}
              onPress={() => switchTab(item.id)}
              android_ripple={{ borderless: true, color: "rgba(255, 255, 255, 0.15)" }}
              hitSlop={{ top: 14, bottom: 10, left: 12, right: 12 }}
              style={({ pressed }) => [
                styles.tabItem,
                pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] },
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
                  size={24}
                  color={isActive ? "#000000" : INACTIVE_COLOR}
                />
                {item.id === "settings" && attentionCount > 0 && (
                  <View style={styles.tabBadgeDot} />
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
          {/* Dismissible library attention banner */}
          {attentionCount > 0 && attentionFingerprint !== dismissedFingerprint && !current && tab !== "settings" && (
            <View style={styles.attentionBanner}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={styles.attentionDot} />
                <Text style={styles.attentionBannerText}>
                  {attentionCount} title{attentionCount > 1 ? "s" : ""} in your library need attention
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable
                  onPress={() => switchTab("settings")}
                  style={styles.attentionBannerAction}
                  accessibilityRole="button"
                >
                  <Text style={styles.attentionBannerActionText}>Review</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDismissedFingerprint(attentionFingerprint)}
                  hitSlop={10}
                  accessibilityLabel="Dismiss notice"
                  accessibilityRole="button"
                >
                  <Icon name="close" size={16} color="rgba(255,255,255,0.7)" />
                </Pressable>
              </View>
            </View>
          )}

          {/* Main content: Offline mode vs Online tab screens */}
          {!isOnline && !current ? (
            !hasCompletedDownloads ? (
              <View style={styles.offlineEmptyRoot}>
                <View style={styles.offlineCard}>
                  <View style={styles.offlineIconCircle}>
                    <Icon name="search" size={32} color="#ffffff" />
                  </View>
                  <Text style={styles.offlineTitle}>You are offline</Text>
                  <Text style={styles.offlineSubtitle}>
                    You don't have any downloads. Please come back when you are online.
                  </Text>
                  <Button
                    label={checkingConnection ? "Connecting..." : "Retry Connection"}
                    disabled={checkingConnection}
                    onPress={() => void handleRetryConnection()}
                    style={{ marginTop: 24, minWidth: 180 }}
                  />
                </View>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <View style={styles.offlineBanner}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Icon name="download" size={16} color="#3B7DF9" />
                    <Text style={styles.offlineBannerText}>
                      Offline Mode • Showing Downloads
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void handleRetryConnection()}
                    style={styles.offlineRetryBtn}
                  >
                    <Text style={styles.offlineRetryText}>
                      {checkingConnection ? "Checking..." : "Reconnect"}
                    </Text>
                  </Pressable>
                </View>
                <LibraryScreen
                  kind="series"
                  defaultSubTab="downloads"
                  open={open}
                  openDownloads={openDownloads}
                />
              </View>
            )
          ) : (
            <>
              {/* Offline catalog banner */}
              {cachedCatalog && isOnline && (
                <Label muted style={{ padding: 12 }}>
                  Offline catalog. Connect to refresh your library, or open
                  Downloads to play saved media.
                </Label>
              )}

              <View style={{ flex: 1, position: "relative" }}>
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
                          <FocusGroup style={{ flex: 1 }}>
                            <DetailScreen
                              id={route.id}
                              back={back}
                              play={(id) => play(id)}
                              download={(item, fileId) => setPicker({ item, fileId })}
                            />
                          </FocusGroup>
                        </PageTransition>
                      ),
                  )}
              </View>
            </>
          )}
        </View>

        {/* Mobile: bottom tab bar */}
        {!isTv && isOnline && <MobileTabBar />}
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

  // ── Mobile bottom tab bar ─────────────────────────────────────────────────
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#000000",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    gap: 4,
  },
  tabIconWrap: {
    minWidth: 64,
    height: 38,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 19,
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
    right: 4,
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
  tabBadgeDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
    borderWidth: 1.5,
    borderColor: "#0b0b0b",
  },
  attentionBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderColor: "rgba(245, 158, 11, 0.35)",
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attentionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
  },
  attentionBannerText: {
    color: "#fef3c7",
    fontSize: 13,
    fontWeight: "500",
  },
  attentionBannerAction: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#f59e0b",
    borderRadius: 6,
  },
  attentionBannerActionText: {
    color: "#000",
    fontSize: 12,
    fontWeight: "700",
  },
  tabLabel: {
    fontSize: 12,
    letterSpacing: 0.15,
    textAlign: "center",
  },

  // ── TV sidebar ────────────────────────────────────────────────────────────
  tvSidebar: {
    width: 176,
    backgroundColor: "#0a0a0a",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: TAB_BAR_BORDER,
    paddingVertical: 16,
    justifyContent: "space-between",
  },
  tvSidebarCollapsed: {
    width: 56,
    alignItems: "center",
  },
  tvBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 20,
  },
  tvBrandRowCollapsed: {
    paddingHorizontal: 0,
    justifyContent: "center",
    paddingBottom: 20,
    width: "100%",
  },
  tvBrandText: {
    fontSize: 18,
    fontWeight: "900",
    color: ACTIVE_COLOR,
    letterSpacing: -0.5,
    fontFamily: "Archivo_900Black",
  },
  tvSidebarToggle: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  tvSidebarToggleCollapsed: {
    alignSelf: "center",
  },
  tvSidebarToggleFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  tvNavItems: {
    flex: 1,
    gap: 2,
    paddingHorizontal: 8,
  },
  tvNavItemsCollapsed: {
    paddingHorizontal: 0,
    alignItems: "center",
    width: "100%",
  },
  tvNavItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tvNavItemCollapsed: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    borderRadius: 8,
    marginVertical: 1,
  },
  tvNavItemActive: {
    backgroundColor: "#ffffff",
  },
  tvNavItemCollapsedActive: {
    backgroundColor: "#ffffff",
  },
  tvNavItemFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  tvNavItemCollapsedFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  tvNavLabel: {
    fontSize: 12.5,
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
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  tvUserRowCollapsed: {
    paddingHorizontal: 0,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    paddingTop: 16,
  },
  tvAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: BRAND_BLUE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tvAvatarText: {
    fontSize: 12,
    fontWeight: "700",
    color: ACTIVE_COLOR,
    fontFamily: "Archivo_700Bold",
  },
  tvUserName: {
    fontSize: 11,
    color: INACTIVE_COLOR,
    fontFamily: "Archivo_400Regular",
    flex: 1,
  },

  // ── Offline mode styles ───────────────────────────────────────────────────
  offlineEmptyRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  offlineCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#111114",
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  offlineIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  offlineTitle: {
    fontSize: 20,
    fontFamily: "Archivo_700Bold",
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  offlineSubtitle: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: "#999999",
    textAlign: "center",
    lineHeight: 20,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(59, 125, 249, 0.12)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(59, 125, 249, 0.25)",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  offlineBannerText: {
    fontSize: 12.5,
    fontFamily: "Archivo_600SemiBold",
    color: "#ffffff",
  },
  offlineRetryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  offlineRetryText: {
    fontSize: 11,
    fontFamily: "Archivo_600SemiBold",
    color: "#ffffff",
  },
});
