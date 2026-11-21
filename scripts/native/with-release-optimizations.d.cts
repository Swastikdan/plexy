export const RELEASE_PROPERTIES: Record<string, string>;
export function upsertProperty(
  properties: { type: string; key: string; value: string }[],
  key: string,
  value: string,
): void;
declare const plugin: (config: import('expo/config').ExpoConfig) => import('expo/config').ExpoConfig;
export default plugin;
