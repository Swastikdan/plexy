/**
 * On-device maturity policy for Kids & Family mode.
 *
 * The server already stores per-account `maxAge` / `blockUnrated` limits. The
 * mobile app is local-first, so the same rules are mirrored here and applied
 * to the local library, the online catalog, cards and title pages.
 */

export type FamilyLevel = "off" | "little" | "older" | "teen";

export const familyLevelLabels: Record<FamilyLevel, string> = {
  off: "Off",
  little: "Little kids · G / TV-Y7",
  older: "Older kids · PG / TV-PG",
  teen: "Teens · PG-13 / TV-14",
};

export const familyLevelDescriptions: Record<FamilyLevel, string> = {
  off: "Every title can be shown.",
  little: "Only G/U, TV-Y, TV-Y7 and TV-G titles.",
  older: "Up to PG and TV-PG titles.",
  teen: "Up to PG-13 and TV-14 titles. R, NC-17, TV-MA and adult titles stay hidden.",
};

/** Highest age allowed for each level. `null` means the filter is off. */
export function familyMaxAge(level: FamilyLevel): number | null {
  // TV-Y7 is 7, so the little-kids level must admit 7-year-old ratings while
  // PG (10) stays out.
  if (level === "little") return 7;
  if (level === "older") return 10;
  if (level === "teen") return 14;
  return null;
}

/** Numeric age for TV/Movie certifications, matching the server's access rules. */
export function certificationAge(value: unknown): number | null {
  const label = String(value ?? "")
    .trim()
    .toUpperCase();
  const mapped: Record<string, number> = {
    U: 0,
    G: 0,
    "TV-Y": 0,
    "TV-G": 0,
    "TV-Y7": 7,
    C: 0,
    P: 0,
    C8: 8,
    PG: 10,
    "TV-PG": 10,
    PG12: 12,
    UA: 13,
    "U/A": 13,
    "PG-13": 13,
    "14A": 14,
    "TV-14": 14,
    M: 15,
    "MA15+": 15,
    "R15+": 15,
    R: 17,
    "R18+": 18,
    A: 18,
    "NC-17": 18,
    "TV-MA": 18,
    S: 18,
  };
  if (label in mapped) return mapped[label]!;
  const match =
    /^(?:U\/?A\s*)?(0|6|7|9|12|13|14|15|16|17|18|21)(?:A|\+)?$/.exec(label);
  return match ? Number(match[1]) : null;
}

export function familyAllows(
  certification: string | null | undefined,
  level: FamilyLevel,
  blockUnrated: boolean,
): boolean {
  const maxAge = familyMaxAge(level);
  if (maxAge == null) return true;
  const age = certificationAge(certification);
  if (age == null) return !blockUnrated;
  // Family mode never allows 18+ content, regardless of the selected limit.
  if (age >= 18) return false;
  return age <= maxAge;
}

export interface AudiencePolicy {
  maxAge: number | null;
  blockUnrated: boolean;
}

let policy: AudiencePolicy = { maxAge: null, blockUnrated: false };
let version = 0;

export function setAudiencePolicy(
  level: FamilyLevel,
  blockUnrated: boolean,
): AudiencePolicy {
  const next: AudiencePolicy = {
    maxAge: familyMaxAge(level),
    blockUnrated: level === "off" ? false : blockUnrated,
  };
  if (
    next.maxAge !== policy.maxAge ||
    next.blockUnrated !== policy.blockUnrated
  ) {
    policy = next;
    version += 1;
  }
  return policy;
}

export function audiencePolicy() {
  return policy;
}

/** Bumps whenever the policy changes, so catalog caches can be rebuilt. */
export function audienceVersion() {
  return version;
}

/** The plain-module check used by the local catalog adapter. */
export function audienceAllows(certification: string | null | undefined) {
  if (policy.maxAge == null) return true;
  const age = certificationAge(certification);
  if (age == null) return !policy.blockUnrated;
  if (age >= 18) return false;
  return age <= policy.maxAge;
}

/** Rating systems offered in Settings. The certificate strings come from TMDB. */
export const familyRegions: [string, string][] = [
  ["US", "United States"],
  ["IN", "India"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["JP", "Japan"],
  ["DE", "Germany"],
  ["FR", "France"],
];

export function familyRegionLabel(region: string) {
  return familyRegions.find(([code]) => code === region)?.[1] ?? region;
}

/**
 * Explicit certificate lists for TMDB discovery. Using a list is more
 * predictable than TMDB's string comparisons across rating systems
 * ("U/A 16+" does not sort like "PG-13").
 */
const movieCertificates: Record<string, Record<0 | 10 | 14, string>> = {
  US: { 0: "G", 10: "G,PG", 14: "G,PG,PG-13" },
  IN: { 0: "U", 10: "U", 14: "U,U/A 13+" },
  GB: { 0: "U", 10: "U,PG", 14: "U,PG,12,12A" },
  CA: { 0: "G", 10: "G,PG", 14: "G,PG,14A" },
  AU: { 0: "G", 10: "G,PG", 14: "G,PG" },
  JP: { 0: "G", 10: "G", 14: "G,PG12" },
  DE: { 0: "0", 10: "0,6", 14: "0,6,12" },
  FR: { 0: "U", 10: "U", 14: "U,12" },
};

const tvCertificates: Record<string, Record<0 | 10 | 14, string>> = {
  US: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
  // Indian television uses the same U / U/A age bands as films in TMDB.
  IN: {
    0: "U",
    10: "U",
    14: "U,U/A 13+",
  },
  GB: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
  CA: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
  AU: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
  JP: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
  DE: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
  FR: {
    0: "TV-Y,TV-Y7,TV-G",
    10: "TV-Y,TV-Y7,TV-G,TV-PG",
    14: "TV-Y,TV-Y7,TV-G,TV-PG,TV-14",
  },
};

export function familyCertificateList(
  region: string,
  maxAge: number,
  tv: boolean,
): string {
  const code = (region || "US").toUpperCase();
  const source = tv ? tvCertificates : movieCertificates;
  const table = source[code] ?? source.US!;
  const age: 0 | 10 | 14 = maxAge <= 7 ? 0 : maxAge <= 10 ? 10 : 14;
  return table[age];
}
