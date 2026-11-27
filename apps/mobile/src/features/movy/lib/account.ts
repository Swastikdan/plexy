import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  loginAccount,
  registerAccount,
  type MovyAuthReply,
} from "./api";
import type { MovyAccount, MovyAccountRecord, MovyQuota } from "./types";

const ACCOUNTS_KEY = "plexy.movy.accounts";
const ACTIVE_KEY = "plexy.movy.active";
const LEGACY_KEY = "plexy.movy.account";
const DEVICE_KEY = "plexy.movy.device";
const REPLACEMENT_LOG_KEY = "plexy.movy.account-log";

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
): Promise<MovyAccountRecord> {
  const id = await deviceId();
  const username = generateUsername();
  const password = generatePassword();
  const reply = await registerAccount({ username, password, deviceId: id });
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
