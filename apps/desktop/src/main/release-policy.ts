export type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
  digest?: string | null;
};
export type Release = {
  tag_name?: string;
  html_url?: string;
  draft?: boolean;
  assets?: ReleaseAsset[];
};
const PRODUCT_NAME = "Plexy Beta";
export function versionFromTag(tag: string): string | null {
  return (
    tag.match(/^v?(\d+\.\d+\.\d+(?:-beta\.\d+)?)(?:-build\.\d+)?$/)?.[1] ?? null
  );
}
export function compareReleaseTags(left: string, right: string): number {
  const parse = (tag: string) => {
    const match = versionFromTag(tag)?.match(
      /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/,
    );
    return match
      ? {
          parts: match.slice(1, 4).map(Number),
          beta: match[4] === undefined ? null : Number(match[4]),
          build: Number(tag.match(/-build\.(\d+)$/)?.[1] ?? 0),
        }
      : null;
  };
  const a = parse(left),
    b = parse(right);
  if (!a || !b) return left.localeCompare(right, undefined, { numeric: true });
  for (let index = 0; index < 3; index++) {
    const difference = a.parts[index]! - b.parts[index]!;
    if (difference) return difference;
  }
  if (a.beta === null && b.beta !== null) return 1;
  if (a.beta !== null && b.beta === null) return -1;
  if (a.beta !== null && b.beta !== null && a.beta !== b.beta)
    return a.beta - b.beta;
  return a.build - b.build;
}
const normalizedName = (name: string) => name.replace(/\s+/g, ".");
export function desktopUpdateAssets(release: Release) {
  const version = versionFromTag(release.tag_name ?? "");
  const expected = `${PRODUCT_NAME}-${version}-arm64.zip`;
  const zip = version
    ? release.assets?.find(
        (asset) =>
          asset.name &&
          normalizedName(asset.name) === normalizedName(expected) &&
          asset.browser_download_url,
      )
    : undefined;
  const sums = release.assets?.find(
    (asset) => asset.name === "SHA256SUMS" && asset.browser_download_url,
  );
  return {
    zip,
    sums,
    verified: Boolean(
      zip && (sums || /^sha256:[a-f0-9]{64}$/i.test(zip.digest ?? "")),
    ),
  };
}
/** Component-only releases must not hide the latest installable desktop build. */
export function selectDesktopRelease(releases: Release[]): Release | null {
  return (
    releases
      .filter(
        (release) =>
          !release.draft &&
          versionFromTag(release.tag_name ?? "") &&
          desktopUpdateAssets(release).verified,
      )
      .sort((a, b) => compareReleaseTags(b.tag_name!, a.tag_name!))[0] ?? null
  );
}
/** GitHub replaces spaces with dots in asset names; checksum manifests keep spaces. */
export function checksumForAsset(
  contents: string,
  assetName: string,
): string | undefined {
  for (const line of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64}) [ *](.+)$/i);
    if (match && normalizedName(match[2]!) === normalizedName(assetName))
      return match[1]!.toLowerCase();
  }
}

/** A late macOS upload may be absent from the shared release manifest. */
export function updateChecksum(
  asset: ReleaseAsset,
  manifest: string | null,
): string | undefined {
  const listed = manifest === null ? undefined : checksumForAsset(manifest, asset.name ?? "");
  // Keep a manifest checksum authoritative when present: a mismatch must fail.
  return listed ?? (/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")
    ? asset.digest!.slice(7).toLowerCase()
    : undefined);
}
