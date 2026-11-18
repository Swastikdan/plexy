export interface MobileDeliveryState {
  nativeFingerprint: string;
  runtimeVersion: string;
  bundleHash: string;
  policyHash: string;
}

export interface ExpoDelivery {
  message: string;
  isRollBackToEmbedded: boolean;
}

export function otaMessage(bundleHash: string) {
  return `Plexy Android ${bundleHash}`;
}

export function isAndroidBundleCurrent(bundleHash: string, embeddedHash: string, history: ExpoDelivery[]) {
  const [latest, previous] = history;
  const published = (update: ExpoDelivery | undefined) => update?.message.startsWith(`"${otaMessage(bundleHash)}" `);
  if (!latest) return bundleHash === embeddedHash;
  if (latest.isRollBackToEmbedded) return bundleHash === embeddedHash || Boolean(published(previous));
  return Boolean(published(latest));
}

export function readMobileDeliveryState(value: unknown): MobileDeliveryState | undefined {
  if (value === undefined) return undefined;
  const state = value as Partial<MobileDeliveryState> | null;
  const sha256 = /^[a-f0-9]{64}$/;
  if (!state || typeof state.nativeFingerprint !== "string" || !sha256.test(state.nativeFingerprint) ||
      typeof state.runtimeVersion !== "string" || !/^android-[a-f0-9]{64}$/.test(state.runtimeVersion) ||
      typeof state.bundleHash !== "string" || !sha256.test(state.bundleHash) ||
      typeof state.policyHash !== "string" || !sha256.test(state.policyHash)) {
    throw Error("The published Android APK has invalid OTA metadata.");
  }
  return { nativeFingerprint: state.nativeFingerprint, runtimeVersion: state.runtimeVersion, bundleHash: state.bundleHash, policyHash: state.policyHash };
}

export function needsMobileApk(
  baseline: MobileDeliveryState | undefined,
  candidate: Pick<MobileDeliveryState, "nativeFingerprint" | "policyHash">,
) {
  return !baseline || baseline.nativeFingerprint !== candidate.nativeFingerprint || baseline.policyHash !== candidate.policyHash;
}
