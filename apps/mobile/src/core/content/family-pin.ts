import * as Crypto from "expo-crypto";

/** A 4-digit PIN protects Kids & Family mode on this device. */
export const FAMILY_PIN_LENGTH = 4;

export function isValidFamilyPin(pin: string) {
  return new RegExp(`^\\d{${FAMILY_PIN_LENGTH}}$`).test(pin);
}

export async function hashFamilyPin(pin: string) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `plexy-family:${pin}`,
  );
}

export async function verifyFamilyPin(pin: string, hash: string | null) {
  if (!hash) return false;
  if (!isValidFamilyPin(pin)) return false;
  return (await hashFamilyPin(pin)) === hash;
}
