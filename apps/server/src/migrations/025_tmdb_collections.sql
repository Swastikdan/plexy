-- 025 · Automatic TMDB collections ------------------------------------------
-- Movies that belong to a TMDB collection are grouped automatically. The
-- values live beside the rest of the hydrated metadata so collection pages can
-- query them without another network round trip. `collection_checked_at`
-- remembers an empty TMDB result, so a movie with no collection is not fetched
-- again on every restart.

ALTER TABLE item_metadata ADD COLUMN collection_id INTEGER;
ALTER TABLE item_metadata ADD COLUMN collection_name TEXT;
ALTER TABLE item_metadata ADD COLUMN collection_checked_at TEXT;

CREATE INDEX IF NOT EXISTS item_metadata_collection
  ON item_metadata(collection_id);
