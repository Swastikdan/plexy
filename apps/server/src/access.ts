import { type LoopbackContext } from "./essentials";
import { q, type Row } from "./db";
import type { User } from "./accounts";
import { requestUser } from "./auth";

// Unknown certifications remain unrated. Numbers are ages, not TMDB vote scores.
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
    PG: 10,
    "TV-PG": 10,
    UA: 13,
    "U/A": 13,
    "PG-13": 13,
    "TV-14": 14,
    R: 17,
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
function folderMatches(file: string, folder: string): boolean {
  const root = folder.replace(/\/+$/, "");
  return file === root || file.startsWith(`${root}/`);
}
export function canAccessItem(user: User | null, itemId: number): boolean {
  if (!user || user.disabled) return false;
  if (user.role === "admin") return true;
  const chain: Row[] = [];
  let id: number | null = itemId;
  for (let depth = 0; id && depth < 20; depth++) {
    const item = q<Row>(
      "SELECT i.*,m.certification FROM items i LEFT JOIN item_metadata m ON m.item_id=i.id WHERE i.id=?",
    ).get(id);
    if (!item) return false;
    chain.push(item);
    id = item.parent_id == null ? null : Number(item.parent_id);
  }
  if (id || !chain.length) return false;
  let unratedBlocked = false;
  if (user.maxAge != null) {
    const ages = chain
      .map((item) => certificationAge(item.certification))
      .filter((age): age is number => age != null);
    unratedBlocked = !ages.length && user.blockUnrated;
    if (ages.length && Math.max(...ages) > user.maxAge) return false;
  }
  const rules = q<Row>(
    "SELECT scope,target,allowed FROM access_rules WHERE user_id=?",
  ).all(user.id);
  const files = q<Row>(
    `SELECT path FROM media_files WHERE item_id IN (${chain.map(() => "?").join(",")})`,
  ).all(...chain.map((item) => item.id));
  const matching = rules.filter((rule) =>
    rule.scope === "library"
      ? String(chain[0]!.library_id) === rule.target
      : rule.scope === "item"
        ? chain.some(
            (item) =>
              String(item.id) === rule.target || item.public_id === rule.target,
          )
        : files.some((file) =>
            folderMatches(String(file.path), String(rule.target)),
          ),
  );
  if (matching.some((rule) => !rule.allowed)) return false;
  const container = chain[0]!.kind === "series" || chain[0]!.kind === "season";
  if (unratedBlocked && !container) return false;
  if (!unratedBlocked && matching.some((rule) => Boolean(rule.allowed)))
    return true;
  if (container) {
    return q<Row>("SELECT id FROM items WHERE parent_id=?")
      .all(itemId)
      .some((child) => canAccessItem(user, Number(child.id)));
  }
  return false;
}
/** A folder grant must not expose another version of a title from an unshared folder. */
export function canAccessFile(user: User | null, fileId: number): boolean {
  const file = q<Row>("SELECT * FROM media_files WHERE id=?").get(fileId);
  if (!file || !user || !canAccessItem(user, Number(file.item_id)))
    return false;
  if (user.role === "admin") return true;
  const chain = q<Row>(`WITH RECURSIVE lineage AS (
    SELECT id,parent_id,public_id,library_id FROM items WHERE id=?
    UNION SELECT i.id,i.parent_id,i.public_id,i.library_id FROM items i JOIN lineage ON i.id=lineage.parent_id
  ) SELECT * FROM lineage`).all(file.item_id);
  return q<Row>(
    "SELECT scope,target FROM access_rules WHERE user_id=? AND allowed=1",
  )
    .all(user.id)
    .some((rule) =>
      rule.scope === "library"
        ? String(file.library_id) === rule.target
        : rule.scope === "item"
          ? chain.some(
              (item) =>
                String(item.id) === rule.target ||
                item.public_id === rule.target,
            )
          : folderMatches(String(file.path), String(rule.target)),
    );
}

/** Every viewer endpoint is explicit; new server operations are admin-only by default. */
export function accessGuard(ctx: LoopbackContext): Response | undefined {
  const { request } = ctx;
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith("/api/") ||
    request.method === "OPTIONS" ||
    path.startsWith("/api/auth/") ||
    /^\/api\/server\/status\/?$/.test(path)
  )
    return;
  const user = requestUser(request);
  if (!user)
    return Response.json({ error: "Sign in required." }, { status: 401 });
  const viewer =
    ["GET", "HEAD"].includes(request.method) &&
    /^\/api\/(?:home|items(?:\/[^/]+)?|search|libraries(?:\/\d+)?|play\/\d+|playability\/\d+|skip-segments\/\d+|stream\/\d+(?:\/[^/]+){0,2}|download\/\d+(?:\/info)?|images\/\d+|people\/\d+\/photo|trickplay\/\d+\/[^/]+|subtitles\/\d+(?:\/[^/]+)?)\/?$/.test(
      path,
    );
  const progress =
    request.method === "POST" &&
    (path === "/api/progress" || /^\/api\/watch\/\d+\/played$/.test(path));
  const clearWatch =
    request.method === "DELETE" && /^\/api\/watch\/\d+$/.test(path);
  if (user.role === "admin") return;
  if (!viewer && !progress && !clearWatch)
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  let itemId: number | null = null;
  const file =
    /^\/api\/(?:play|playability|skip-segments|stream|download|trickplay|subtitles)\/(\d+)/.exec(
      path,
    );
  const image = /^\/api\/images\/(\d+)/.exec(path);
  const item = /^\/api\/(?:items|watch)\/([^/]+)/.exec(path);
  const person = /^\/api\/people\/(\d+)\/photo/.exec(path);
  if (file && !canAccessFile(user, Number(file[1])))
    return Response.json({ error: "Not found." }, { status: 404 });
  if (file)
    itemId = Number(
      q<Row>("SELECT item_id FROM media_files WHERE id=?").get(Number(file[1]))
        ?.item_id ?? 0,
    );
  if (image)
    itemId = Number(
      q<Row>("SELECT item_id FROM artwork WHERE id=?").get(Number(image[1]))
        ?.item_id ?? 0,
    );
  if (item)
    itemId = Number(
      q<Row>(
        "SELECT id FROM items WHERE CAST(id AS TEXT)=? OR public_id=?",
      ).get(item[1], item[1])?.id ?? 0,
    );
  if (person) {
    const related = q<Row>(
      "SELECT item_id FROM item_people WHERE person_id=?",
    ).all(Number(person[1]));
    if (!related.some((row) => canAccessItem(user, Number(row.item_id))))
      itemId = 0;
  }
  if (itemId != null && !canAccessItem(user, itemId))
    return Response.json({ error: "Not found." }, { status: 404 });
}

const visibleIdsByRequest = new WeakMap<Request, number[]>();

/** Apply access before pagination so inaccessible titles cannot empty visible pages. */
export function accessSql(request: Request, column = "i.id"): string {
  const user = requestUser(request);
  // `authGuard` rejects unauthenticated API requests whenever authentication is
  // enabled, so a missing user means this server is running open (the test
  // harness) and every item is visible.
  if (user?.role === "admin" || !user) return "1=1";
  let ids = visibleIdsByRequest.get(request);
  if (!ids) {
    ids = q<Row>("SELECT id FROM items")
      .all()
      .filter((row) => canAccessItem(user, Number(row.id)))
      .map((row) => Number(row.id));
    visibleIdsByRequest.set(request, ids);
  }
  return ids.length ? `${column} IN (${ids.join(",")})` : "0=1";
}
