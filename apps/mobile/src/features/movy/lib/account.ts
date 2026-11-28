import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  loginAccount,
  registerAccount,
  type MovyAuthReply,
} from "./api";
import {
  MovyError,
  type MovyAccount,
  type MovyAccountRecord,
  type MovyQuota,
} from "./types";

const ACCOUNTS_KEY = "plexy.movy.accounts";
const ACTIVE_KEY = "plexy.movy.active";
const LEGACY_KEY = "plexy.movy.account";
const DEVICE_KEY = "plexy.movy.device";
const REPLACEMENT_LOG_KEY = "plexy.movy.account-log";
const BACKOFF_KEY = "plexy.movy.account-backoff";

// Account creation backs off after a refused or failed registration so a
// busy or rate-limiting source is not hammered: 1 min, 2, 4 … up to 6 h.
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;

export interface AccountBackoff {
  failures: number;
  until: number;
}

export async function accountCreationBackoff(): Promise<AccountBackoff> {
  try {
    const raw = await AsyncStorage.getItem(BACKOFF_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AccountBackoff>) : null;
    return {
      failures: Number(parsed?.failures) || 0,
      until: Number(parsed?.until) || 0,
    };
  } catch {
    return { failures: 0, until: 0 };
  }
}

async function recordCreationFailure(retryAfterSeconds: number | null) {
  const current = await accountCreationBackoff();
  const failures = current.failures + 1;
  const delay = Math.min(
    BACKOFF_MAX_MS,
    Math.max(
      BACKOFF_BASE_MS * 2 ** (failures - 1),
      (retryAfterSeconds ?? 0) * 1000,
    ),
  );
  await AsyncStorage.setItem(
    BACKOFF_KEY,
    JSON.stringify({ failures, until: Date.now() + delay }),
  ).catch(() => {});
}

export async function resetAccountCreationBackoff() {
  await AsyncStorage.removeItem(BACKOFF_KEY).catch(() => {});
}

const USERNAME_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

function randomIndex(length: number) {
  const bytes = Crypto.getRandomBytes(4);
  const value =
    ((bytes[0] ?? 0) << 24) |
    ((bytes[1] ?? 0) << 16) |
    ((bytes[2] ?? 0) << 8) |
    (bytes[3] ?? 0);
  return (value >>> 0) % length;
}

export function generateUsername(): string {
  let suffix = "";
  for (let index = 0; index < 10; index += 1) {
    suffix += USERNAME_ALPHABET[randomIndex(USERNAME_ALPHABET.length)]!;
  }
  return `plexy${suffix}`;
}

export function generatePassword(): string {
  let password = "";
  for (let index = 0; index < 18; index += 1) {
    password += PASSWORD_ALPHABET[randomIndex(PASSWORD_ALPHABET.length)]!;
  }
  return password;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY).catch(() => null);
  if (existing && /^[0-9a-f]{32}$/i.test(existing)) return existing;
  const next = hex(Crypto.getRandomBytes(16));
  await SecureStore.setItemAsync(DEVICE_KEY, next).catch(() => {});
  return next;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeAccounts(accounts: MovyAccountRecord[]) {
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export async function loadAccounts(): Promise<MovyAccountRecord[]> {
  const rawAccounts = await SecureStore.getItemAsync(ACCOUNTS_KEY).catch(
    () => null,
  );
  if (rawAccounts !== null) {
    try {
      const stored = JSON.parse(rawAccounts) as unknown;
      return Array.isArray(stored)
        ? stored.filter(
            (entry): entry is MovyAccountRecord =>
              Boolean(entry) &&
              typeof entry.username === "string" &&
              typeof entry.token === "string" &&
              typeof entry.deviceId === "string",
          )
        : [];
    } catch {
      return [];
    }
  }

  // Migrate the single-account key used by the old dev build.
  const legacy = await readJson<MovyAccount>(LEGACY_KEY);
  if (legacy?.username && legacy.token) {
    const migrated: MovyAccountRecord = {
      ...legacy,
      quota: null,
      lastUsedAt: null,
    };
    await writeAccounts([migrated]);
    await SecureStore.setItemAsync(ACTIVE_KEY, legacy.username).catch(() => {});
    return [migrated];
  }
  return [];
}

export async function activeAccount(
  accounts: readonly MovyAccountRecord[],
): Promise<MovyAccountRecord | null> {
  const name = await SecureStore.getItemAsync(ACTIVE_KEY).catch(() => null);
  return (
    accounts.find((account) => account.username === name) ??
    accounts[0] ??
    null
  );
}

export async function setActiveAccount(username: string) {
  await SecureStore.setItemAsync(ACTIVE_KEY, username);
}

export async function saveAccounts(accounts: MovyAccountRecord[]) {
  await writeAccounts(accounts);
  if (accounts.length && !(await SecureStore.getItemAsync(ACTIVE_KEY))) {
    await setActiveAccount(accounts[0]!.username);
  }
}

export async function createGeneratedAccount(
  accounts: MovyAccountRecord[],
  options: { automatic?: boolean } = {},
): Promise<MovyAccountRecord> {
  if (options.automatic) {
    const backoff = await accountCreationBackoff();
    if (backoff.until > Date.now()) {
      const minutes = Math.ceil((backoff.until - Date.now()) / 60_000);
      throw new MovyError(
        "quota",
        `Too many account requests. Plexy will try again in ${minutes} min.`,
        { retryAfterSeconds: Math.ceil((backoff.until - Date.now()) / 1000) },
      );
    }
  }
  const id = await deviceId();
  const username = generateUsername();
  const password = generatePassword();
  let reply: MovyAuthReply;
  try {
    reply = await registerAccount({ username, password, deviceId: id });
  } catch (cause) {
    // Invalid input (e.g. a taken name) is not a sign of rate limiting.
    if (!(cause instanceof MovyError) || cause.code !== "invalid")
      await recordCreationFailure(
        cause instanceof MovyError ? cause.retryAfterSeconds : null,
      );
    throw cause;
  }
  await resetAccountCreationBackoff();
  const record: MovyAccountRecord = {
    username: reply.username || username,
    token: reply.token,
    deviceId: id,
    generatedPassword: password,
    createdAt: Date.now(),
    quota: null,
    lastUsedAt: null,
  };
  const next = [...accounts, record];
  await saveAccounts(next);
  await setActiveAccount(record.username);
  return record;
}

export async function signInExisting(
  accounts: MovyAccountRecord[],
  username: string,
  password: string,
): Promise<MovyAccountRecord> {
  const id = await deviceId();
  const reply: MovyAuthReply = await loginAccount({
    username,
    password,
    deviceId: id,
  });
  const record: MovyAccountRecord = {
    username: reply.username || username.trim(),
    token: reply.token,
    deviceId: id,
    createdAt: Date.now(),
    quota: null,
    lastUsedAt: null,
  };
  const next = [
    ...accounts.filter((entry) => entry.username !== record.username),
    record,
  ];
  await saveAccounts(next);
  await setActiveAccount(record.username);
  return record;
}

export async function removeAccount(
  accounts: MovyAccountRecord[],
  username: string,
): Promise<MovyAccountRecord[]> {
  const next = accounts.filter((account) => account.username !== username);
  await saveAccounts(next);
  const active = await SecureStore.getItemAsync(ACTIVE_KEY).catch(() => null);
  if (active === username) {
    if (next[0]) await setActiveAccount(next[0].username);
    else await SecureStore.deleteItemAsync(ACTIVE_KEY).catch(() => {});
  }
  return next;
}

export async function updateQuota(
  accounts: MovyAccountRecord[],
  username: string,
  quota: MovyQuota | null,
): Promise<MovyAccountRecord[]> {
  const next = accounts.map((account) =>
    account.username === username
      ? { ...account, quota, lastUsedAt: Date.now() }
      : account,
  );
  await saveAccounts(next);
  return next;
}

export async function replacementAllowed(cap: number): Promise<boolean> {
  const timestamps = await readReplacementLog();
  return timestamps.length < cap;
}

/** Replacement accounts created automatically in the last 24 hours. */
export async function replacementsToday(): Promise<number> {
  return (await readReplacementLog()).length;
}

export async function recordReplacement(): Promise<void> {
  const timestamps = await readReplacementLog();
  timestamps.push(Date.now());
  await AsyncStorage.setItem(
    REPLACEMENT_LOG_KEY,
    JSON.stringify(timestamps),
  ).catch(() => {});
}

async function readReplacementLog(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(REPLACEMENT_LOG_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const cutoff = Date.now() - 24 * 60 * 60_000;
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is number =>
            typeof value === "number" && value >= cutoff,
        )
      : [];
  } catch {
    return [];
  }
}

export function quotaLabel(quota: MovyQuota | null): string {
  if (!quota) return "Quota unknown";
  if (quota.limit <= 0) return "Quota unavailable";
  return `${quota.remaining} of ${quota.limit} downloads left`;
}

export function resetLabel(quota: MovyQuota | null): string | null {
  if (!quota?.resetAt) return null;
  const date = new Date(quota.resetAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Resets ${date.toLocaleDateString()}`;
}
