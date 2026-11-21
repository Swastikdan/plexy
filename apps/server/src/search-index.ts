/// Full-text catalog index.
///
/// SQLite FTS5 is shipped by Bun, so the search route can use bm25 ranking
/// instead of a leading-wildcard LIKE scan. The index stores one row per item
/// with its parent series and cast names folded in: searching "The Bear" then
/// finds episodes, and searching an actor finds their titles.
import { q, run, type Row } from "./db";

export interface SearchHit {
  itemId: number;
  rank: number;
}

let catalogVerified = false;

function termsFor(query: string): string[] {
  return query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, 8);
}

/** FTS5 query: each token is a prefix, all tokens must match. */
export function ftsQuery(query: string): string | null {
  const terms = termsFor(query);
  if (!terms.length) return null;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" AND ");
}

/** Rebuild every row. Called after a scan and on first search of an old DB. */
export function rebuildSearchIndex(): void {
  run("DELETE FROM item_search");
  run(
    `INSERT INTO item_search(item_id, name, sort_title, parent_title, overview, genres, people)
     SELECT i.id, i.name, i.sort_title, COALESCE(p.name, ''),
            COALESCE(m.overview, ''), COALESCE(m.genres, ''),
            COALESCE(group_concat(pp.name, ' '), '')
     FROM items i
     LEFT JOIN items p ON p.id = i.parent_id
     LEFT JOIN item_metadata m ON m.item_id = i.id
     LEFT JOIN item_people ip ON ip.item_id = i.id
     LEFT JOIN people pp ON pp.id = ip.person_id
     WHERE i.kind IN ('movie','series','episode')
     GROUP BY i.id`,
  );
  catalogVerified = true;
}

/** Refresh one title after hydration, metadata edit, or a manual match. */
export function indexItem(itemId: number): void {
  run("DELETE FROM item_search WHERE item_id = ?", itemId);
  run(
    `INSERT INTO item_search(item_id, name, sort_title, parent_title, overview, genres, people)
     SELECT i.id, i.name, i.sort_title, COALESCE(p.name, ''),
            COALESCE(m.overview, ''), COALESCE(m.genres, ''),
            COALESCE((
              SELECT group_concat(pp.name, ' ')
              FROM item_people ip JOIN people pp ON pp.id = ip.person_id
              WHERE ip.item_id = i.id
            ), '')
     FROM items i
     LEFT JOIN items p ON p.id = i.parent_id
     LEFT JOIN item_metadata m ON m.item_id = i.id
     WHERE i.id = ? AND i.kind IN ('movie','series','episode')`,
    itemId,
  );
}

export function searchIndexSize(): number {
  return Number(
    q<{ n: number }>("SELECT COUNT(*) AS n FROM item_search").get()?.n ?? 0,
  );
}

export function catalogItemCount(): number {
  return Number(
    q<{ n: number }>(
      "SELECT COUNT(*) AS n FROM items WHERE kind IN ('movie','series','episode')",
    ).get()?.n ?? 0,
  );
}

/** Keep an older database usable: an empty index is rebuilt lazily. */
export function ensureSearchIndex(): void {
  // The two COUNTs cost ~2.3 ms per search at 20k items. Once the index has
  // been verified (or rebuilt after a scan) it stays valid until a row is
  // deleted outside the scanner, which calls `invalidateSearchIndex`.
  if (catalogVerified) return;
  const indexed = searchIndexSize();
  const items = catalogItemCount();
  if (items > 0 && indexed !== items) rebuildSearchIndex();
  catalogVerified = true;
}

/** Drop the verified flag after a bulk delete outside `rebuildSearchIndex`. */
export function invalidateSearchIndex(): void {
  catalogVerified = false;
}

/** Remove one title's index row alongside its catalog row. */
export function removeFromSearchIndex(itemId: number): void {
  run("DELETE FROM item_search WHERE item_id = ?", itemId);
  // Deleting a series cascades its seasons/episodes in `items` but FTS rows are
  // a virtual table without foreign keys. Let the next search verify counts and
  // rebuild once rather than serving orphaned hits.
  catalogVerified = false;
}

export function searchIds(query: string, limit: number, offset: number): SearchHit[] {
  const fts = ftsQuery(query);
  if (!fts) return [];
  return q<Row>(
    `SELECT item_id, bm25(item_search) AS rank
     FROM item_search
     WHERE item_search MATCH ?
     ORDER BY rank
     LIMIT ? OFFSET ?`,
  )
    .all(fts, limit, offset)
    .map((row) => ({ itemId: Number(row.item_id), rank: Number(row.rank) }));
}

/**
 * Fallback for one- or two-character queries and FTS misses. This is still a
 * bounded scan, but it only runs when the fast path has nothing to return.
 */
export function fallbackIds(query: string, limit: number, offset: number): SearchHit[] {
  const like = `%${query.trim()}%`;
  if (like === "%%") return [];
  return q<Row>(
    `SELECT i.id AS item_id, 0 AS rank
     FROM items i
     LEFT JOIN items p ON p.id = i.parent_id
     LEFT JOIN item_metadata m ON m.item_id = i.id
     WHERE i.name LIKE ? OR p.name LIKE ? OR COALESCE(m.genres, '') LIKE ?
        OR EXISTS (
          SELECT 1 FROM item_people ip JOIN people pp ON pp.id = ip.person_id
          WHERE ip.item_id = i.id AND pp.name LIKE ?
        )
     ORDER BY
       CASE WHEN i.name LIKE ? THEN 0
            WHEN p.name LIKE ? THEN 1
            ELSE 2 END,
       i.sort_title
     LIMIT ? OFFSET ?`,
  )
    .all(like, like, like, like, like, like, limit, offset)
    .map((row) => ({ itemId: Number(row.item_id), rank: Number(row.rank) }));
}

/** People whose name matches the query, for the grouped search results. */
export function searchPeople(query: string, limit = 8): Array<{
  id: number;
  name: string;
  photo: string | null;
}> {
  const like = `%${query.trim()}%`;
  if (like === "%%") return [];
  return q<Row>(
    `SELECT p.id, p.name, p.profile_path
     FROM people p
     WHERE p.name LIKE ?
     ORDER BY p.name
     LIMIT ?`,
  )
    .all(like, limit)
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      photo: row.profile_path
        ? `/api/people/${Number(row.id)}/photo?w=300`
        : null,
    }));
}
