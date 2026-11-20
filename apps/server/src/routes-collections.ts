/// User collections.
///
/// Manual, ordered collections shared by the server's accounts. A collection is
/// a small ordered list of items; smart collections can be added later without
/// changing the client contract.
import { Elysia, t } from "elysia";
import { q, run, type Row } from "./db";
import { apiError } from "./essentials";
import { requestUser } from "./auth";
import { canAccessItem } from "./access";
import { attachArt } from "./routes-catalog";
import type { CollectionSummary } from "@plexy/api-client";

function posterFor(collectionId: number): string | null {
  const row = q<Row>(
    `SELECT a.id FROM collection_items ci
     JOIN artwork a ON a.item_id = ci.item_id AND a.kind = 'poster'
     WHERE ci.collection_id = ?
     ORDER BY ci.position, ci.added_at, a.id LIMIT 1`,
  ).get(collectionId);
  return row ? `/api/images/${Number(row.id)}?w=500` : null;
}

function summary(collectionId: number, itemId?: number): CollectionSummary {
  const collection = q<Row>("SELECT * FROM collections WHERE id = ?").get(collectionId);
  const count = Number(
    q<{ n: number }>("SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?")
      .get(collectionId)?.n ?? 0,
  );
  return {
    id: collectionId,
    name: String(collection?.name ?? "Collection"),
    description: collection?.description == null ? null : String(collection.description),
    count,
    poster: posterFor(collectionId),
    ...(itemId == null
      ? {}
      : {
          contains: Boolean(
            q<Row>("SELECT 1 FROM collection_items WHERE collection_id=? AND item_id=?")
              .get(collectionId, itemId),
          ),
        }),
  };
}

function signedIn(request: Request) {
  const user = requestUser(request);
  if (!user) return null;
  return user;
}

export const collectionRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  .get("/collections", ({ query, request }) => {
    const user = signedIn(request);
    if (!user) return apiError("Sign in required.", 401);
    const itemId = query.itemId == null ? undefined : Number(query.itemId);
    if (itemId != null && !Number.isFinite(itemId)) return apiError("Invalid item id.");
    const rows = q<Row>("SELECT id FROM collections ORDER BY updated_at DESC, id DESC").all();
    return {
      collections: rows.map((row) => summary(Number(row.id), itemId)),
    };
  }, {
    query: t.Object({ itemId: t.Optional(t.Numeric()) }),
  })

  .get("/collections/:id", async ({ params, request }) => {
    const user = signedIn(request);
    if (!user) return apiError("Sign in required.", 401);
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return apiError("Invalid collection id.");
    if (!q<Row>("SELECT id FROM collections WHERE id = ?").get(id)) {
      return apiError("Collection not found.", 404);
    }
    const rows = q<Row>(
      `SELECT i.* FROM items i
       JOIN collection_items ci ON ci.item_id = i.id
       WHERE ci.collection_id = ?
       ORDER BY ci.position, ci.added_at`,
    ).all(id);
    const items = await attachArt(rows, request);
    return { collection: summary(id), items };
  }, { params: t.Object({ id: t.Numeric() }) })

  .post("/collections", ({ body, request }) => {
    const user = signedIn(request);
    if (!user) return apiError("Sign in required.", 401);
    const name = body.name.trim().slice(0, 120);
    if (!name) return apiError("Enter a collection name.");
    run(
      "INSERT INTO collections (name, description, created_by) VALUES (?,?,?)",
      name,
      body.description?.trim().slice(0, 500) || null,
      user.id,
    );
    const row = q<Row>("SELECT id FROM collections ORDER BY id DESC LIMIT 1").get()!;
    return { collection: summary(Number(row.id)) };
  }, {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 120 }),
      description: t.Optional(t.String({ maxLength: 500 })),
    }),
  })

  .post("/collections/:id/items", ({ params, body, request }) => {
    const user = signedIn(request);
    if (!user) return apiError("Sign in required.", 401);
    const id = Number(params.id);
    const itemId = Number(body.itemId);
    if (!q<Row>("SELECT id FROM collections WHERE id = ?").get(id)) {
      return apiError("Collection not found.", 404);
    }
    if (!Number.isInteger(itemId) || !canAccessItem(user, itemId)) {
      return apiError("Title not found.", 404);
    }
    const position = Number(
      q<{ n: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM collection_items WHERE collection_id = ?")
        .get(id)?.n ?? 0,
    );
    run(
      "INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?,?,?)",
      id,
      itemId,
      position,
    );
    run("UPDATE collections SET updated_at = datetime('now') WHERE id = ?", id);
    return { ok: true as const };
  }, {
    params: t.Object({ id: t.Numeric() }),
    body: t.Object({ itemId: t.Numeric() }),
  })

  .delete("/collections/:id/items/:itemId", ({ params, request }) => {
    const user = signedIn(request);
    if (!user) return apiError("Sign in required.", 401);
    const id = Number(params.id);
    const itemId = Number(params.itemId);
    run(
      "DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?",
      id,
      itemId,
    );
    run("UPDATE collections SET updated_at = datetime('now') WHERE id = ?", id);
    return { ok: true as const };
  }, { params: t.Object({ id: t.Numeric(), itemId: t.Numeric() }) })

  .delete("/collections/:id", ({ params, request }) => {
    const user = signedIn(request);
    if (!user) return apiError("Sign in required.", 401);
    run("DELETE FROM collections WHERE id = ?", Number(params.id));
    return { ok: true as const };
  }, { params: t.Object({ id: t.Numeric() }) });
