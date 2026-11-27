import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { useClient } from "@/core/client/client-provider";
import {
  createDownload,
  fetchDownloadOptions,
  type MovyDownloadOptions,
} from "./lib/api";
import {
  activeAccount,
  createGeneratedAccount,
  loadAccounts,
  quotaLabel,
  recordReplacement,
  removeAccount,
  replacementAllowed,
  setActiveAccount,
  signInExisting,
  updateQuota,
} from "./lib/account";
import {
  cacheUrl,
  configureDownloads,
  downloadUrlKey,
  downloadsStore,
  findDownload,
  initDownloadManager,
  loadDownloads,
  loadUrlCache,
  pauseDownload,
  replaceDownloads,
  resumeDownload,
  retryDownload,
  startQueue,
  syncNativeDownloads,
  cancelDownload,
} from "./lib/downloads";
import { localCopy } from "./lib/library-import";
import { bytesOf, heightOf } from "./lib/quality";
import {
  MovyError,
  type MovyAccountRecord,
  type MovyDownload,
  type MovyDownloadRecord,
  type MovyQualityOption,
  type MovyTitleRef,
} from "./lib/types";

export interface DownloadMeta {
  title: string;
  episodeTitle?: string | null;
  display: string;
  poster: string | null;
}

interface MovyContext {
  ready: boolean;
  busy: boolean;
  error: string | null;
  accounts: MovyAccountRecord[];
  active: MovyAccountRecord | null;
  downloads: MovyDownloadRecord[];
  createAccount(): Promise<MovyAccountRecord>;
  signIn(username: string, password: string): Promise<MovyAccountRecord>;
  removeAccount(username: string): Promise<void>;
  selectAccount(username: string): Promise<void>;
  refreshQuota(ref?: MovyTitleRef | null): Promise<void>;
  loadOptions(ref: MovyTitleRef): Promise<MovyDownloadOptions>;
  download(
    ref: MovyTitleRef,
    option: MovyQualityOption,
    meta: DownloadMeta,
  ): Promise<MovyDownloadRecord>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  findDownload(
    mediaType: MovyTitleRef["mediaType"],
    tmdbId: number,
    season?: number | null,
    episode?: number | null,
  ): MovyDownloadRecord | undefined;
  clearError(): void;
}

const Context = createContext<MovyContext | null>(null);

function errorMessage(error: unknown) {
  if (error instanceof MovyError) {
    if (error.code === "quota") return "The download limit has been reached.";
    if (error.code === "auth") return "The download account is not signed in.";
    if (error.code === "network") return "Could not reach the download source.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function MovyProvider({ children }: React.PropsWithChildren) {
  const { preferences } = useClient();
  const downloads = useSyncExternalStore(
    downloadsStore.subscribe,
    downloadsStore.get,
    downloadsStore.get,
  );
  const [accounts, setAccounts] = useState<MovyAccountRecord[]>([]);
  const [active, setActive] = useState<MovyAccountRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountsRef = useRef(accounts);
  const activeRef = useRef(active);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const applyAccounts = useCallback(
    (next: MovyAccountRecord[], preferred?: string | null) => {
      setAccounts(next);
      const currentName = preferred ?? activeRef.current?.username ?? null;
      setActive(
        next.find((account) => account.username === currentName) ??
          next[0] ??
          null,
      );
    },
    [],
  );

  useEffect(() => {
    configureDownloads({
      background: preferences.movyBackgroundDownloads,
      multiStream: preferences.movyMultiStream,
      wifiOnly: preferences.movyWifiOnly,
    });
  }, [
    preferences.movyBackgroundDownloads,
    preferences.movyMultiStream,
    preferences.movyWifiOnly,
  ]);

  useEffect(() => {
    let live = true;
    initDownloadManager();
    void Promise.all([loadAccounts(), loadDownloads(), loadUrlCache()])
      .then(async ([loadedAccounts]) => {
        if (!live) return;
        applyAccounts(loadedAccounts, (await activeAccount(loadedAccounts))?.username);
        setReady(true);
        await syncNativeDownloads();
        await startQueue();
      })
      .catch((cause) => {
        if (live) {
          setError(errorMessage(cause));
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [applyAccounts]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void syncNativeDownloads();
        void startQueue();
      }
    });
    return () => subscription.remove();
  }, []);

  const createAccount = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const record = await createGeneratedAccount(accountsRef.current);
      const next = [...accountsRef.current, record];
      applyAccounts(next, record.username);
      return record;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [applyAccounts]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        const record = await signInExisting(
          accountsRef.current,
          username,
          password,
        );
        const next = [
          ...accountsRef.current.filter(
            (account) => account.username !== record.username,
          ),
          record,
        ];
        applyAccounts(next, record.username);
        return record;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [applyAccounts],
  );

  const deleteAccount = useCallback(
    async (username: string) => {
      setBusy(true);
      setError(null);
      try {
        const next = await removeAccount(accountsRef.current, username);
        applyAccounts(next, next[0]?.username);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [applyAccounts],
  );

  const selectAccount = useCallback(async (username: string) => {
    await setActiveAccount(username);
    setActive(
      accountsRef.current.find((account) => account.username === username) ??
        null,
    );
  }, []);

  const refreshQuota = useCallback(async (ref?: MovyTitleRef | null) => {
    const account = activeRef.current;
    if (!account) return;
    try {
      if (ref) {
        const reply = await fetchDownloadOptions(account, ref);
        const next = await updateQuota(
          accountsRef.current,
          account.username,
          reply.quota,
        );
        applyAccounts(next, account.username);
      }
    } catch (cause) {
      if (cause instanceof MovyError && cause.code === "auth") {
        setError("The download account is not signed in.");
      }
    }
  }, [applyAccounts]);

  const loadOptions = useCallback(
    async (ref: MovyTitleRef) => {
      const account = activeRef.current;
      if (!account) {
        throw new MovyError(
          "auth",
          "Create or sign in to a download account first.",
        );
      }
      const reply = await fetchDownloadOptions(account, ref);
      const next = await updateQuota(
        accountsRef.current,
        account.username,
        reply.quota,
      );
      applyAccounts(next, account.username);
      return reply;
    },
    [applyAccounts],
  );

  const download = useCallback(
    async (
      ref: MovyTitleRef,
      option: MovyQualityOption,
      meta: DownloadMeta,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const existing = findDownload(
          ref.mediaType,
          ref.tmdbId,
          ref.season,
          ref.episode,
        );
        if (existing && existing.status !== "failed") return existing;
        if (
          localCopy({
            tmdbId: ref.tmdbId,
            mediaType: ref.mediaType,
            season: ref.season ?? null,
            episode: ref.episode ?? null,
          })
        ) {
          throw new Error("This title is already in your library.");
        }

        if (
          Platform.OS === "android" &&
          Number(Platform.Version) >= 33 &&
          preferences.movyNotifications
        ) {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          ).catch(() => {});
        }

        let account = activeRef.current;
        if (!account) {
          throw new MovyError(
            "auth",
            "Create or sign in to a download account first.",
          );
        }

        const attempt = async (candidate: MovyAccountRecord) => {
          try {
            const reply = await createDownload(
              candidate,
              ref,
              option.quality,
            );
            const quota =
              reply.limit != null && reply.remaining != null
                ? {
                    limit: reply.limit,
                    used: Math.max(0, reply.limit - reply.remaining),
                    remaining: reply.remaining,
                    resetAt: reply.resetAt ?? null,
                  }
                : candidate.quota;
            const next = await updateQuota(
              accountsRef.current,
              candidate.username,
              quota,
            );
            applyAccounts(next, candidate.username);
            return reply;
          } catch (cause) {
            if (
              cause instanceof MovyError &&
              (cause.code === "auth" || cause.code === "quota")
            ) {
              const limit = candidate.quota?.limit ?? 0;
              const resetAt =
                cause.code === "quota" && cause.retryAfterSeconds
                  ? new Date(
                      Date.now() + cause.retryAfterSeconds * 1000,
                    ).toISOString()
                  : candidate.quota?.resetAt ?? null;
              const next = await updateQuota(
                accountsRef.current,
                candidate.username,
                cause.code === "quota"
                  ? { limit, used: limit, remaining: 0, resetAt }
                  : { limit: 0, used: 0, remaining: 0, resetAt: null },
              );
              applyAccounts(next, candidate.username);
            }
            throw cause;
          }
        };

        let reply: MovyDownload | null = null;
        let lastError: unknown = null;
        const primary = account;
        const primaryHasQuota =
          primary.quota == null || primary.quota.remaining > 0;
        const candidates = [
          ...(primaryHasQuota ? [primary] : []),
          ...accountsRef.current.filter(
            (candidate) =>
              candidate.username !== primary.username &&
              (candidate.quota == null || candidate.quota.remaining > 0),
          ),
        ];
        for (const candidate of candidates) {
          try {
            if (candidate.username !== primary.username) {
              await setActiveAccount(candidate.username);
            }
            reply = await attempt(candidate);
            account = candidate;
            break;
          } catch (cause) {
            lastError = cause;
            if (
              !(cause instanceof MovyError) ||
              (cause.code !== "auth" && cause.code !== "quota")
            ) {
              throw cause;
            }
          }
        }
        if (
          !reply &&
          preferences.movyAutoCreateAccount &&
          (await replacementAllowed(preferences.movyAccountCap))
        ) {
          try {
            const replacement = await createGeneratedAccount(accountsRef.current);
            await recordReplacement();
            const next = [...accountsRef.current, replacement];
            applyAccounts(next, replacement.username);
            reply = await attempt(replacement);
            account = replacement;
          } catch (cause) {
            lastError = cause;
            if (
              !(cause instanceof MovyError) ||
              (cause.code !== "auth" && cause.code !== "quota")
            ) {
              throw cause;
            }
          }
        }
        if (!reply) {
          throw (
            lastError ??
            new MovyError("quota", "The download limit has been reached.")
          );
        }

        const height = heightOf(option.quality);
        const id = [
          ref.mediaType,
          ref.tmdbId,
          ref.season ?? 0,
          ref.episode ?? 0,
          height || option.quality,
        ].join(":");
        const record: MovyDownloadRecord = {
          id,
          mediaType: ref.mediaType,
          tmdbId: ref.tmdbId,
          imdbId: ref.imdbId,
          year: ref.year,
          season: ref.mediaType === "tv" ? (ref.season ?? 1) : null,
          episode: ref.mediaType === "tv" ? (ref.episode ?? 1) : null,
          title: meta.title || ref.title,
          episodeTitle: meta.episodeTitle ?? null,
          display: meta.display,
          poster: meta.poster,
          quality: reply.quality || option.quality,
          filename: reply.filename,
          accountUsername: account.username,
          url: reply.url,
          urlExpiresAt: Date.now() + 6 * 60 * 60_000,
          expectedBytes: bytesOf(option.size ?? option.quality),
          bytes: 0,
          status: "queued",
          progress: 0,
          strategy: null,
          chunks: null,
          resumeData: null,
          etag: null,
          lastModified: null,
          error: null,
          createdAt: Date.now(),
          completedAt: null,
          libraryUri: null,
          libraryFileId: null,
        };
        cacheUrl(
          downloadUrlKey(record),
          {
            url: reply.url,
            filename: reply.filename,
            quality: record.quality,
          },
          reply.resetAt ?? null,
        );
        const next = [
          record,
          ...downloadsStore
            .get()
            .filter((entry) => entry.id !== record.id),
        ];
        await replaceDownloads(next);
        void refreshQuota(ref);
        void startQueue();
        return record;
      } catch (cause) {
        const message = errorMessage(cause);
        setError(message);
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [
      applyAccounts,
      preferences.movyAccountCap,
      preferences.movyAutoCreateAccount,
      preferences.movyNotifications,
      refreshQuota,
    ],
  );

  const pause = useCallback(async (id: string) => {
    await pauseDownload(id);
  }, []);
  const resume = useCallback(async (id: string) => {
    await resumeDownload(id);
  }, []);
  const retry = useCallback(async (id: string) => {
    await retryDownload(id);
  }, []);
  const remove = useCallback(async (id: string) => {
    await cancelDownload(id);
  }, []);

  const value = useMemo<MovyContext>(
    () => ({
      ready,
      busy,
      error,
      accounts,
      active,
      downloads,
      createAccount,
      signIn,
      removeAccount: deleteAccount,
      selectAccount,
      refreshQuota,
      loadOptions,
      download,
      pause,
      resume,
      retry,
      remove,
      findDownload,
      clearError: () => setError(null),
    }),
    [
      ready,
      busy,
      error,
      accounts,
      active,
      downloads,
      createAccount,
      signIn,
      deleteAccount,
      selectAccount,
      refreshQuota,
      loadOptions,
      download,
      pause,
      resume,
      retry,
      remove,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMovy() {
  const value = useContext(Context);
  if (!value) throw new Error("MovyProvider is missing");
  return value;
}

export { quotaLabel };
