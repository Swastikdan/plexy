-- 019 · Catalog full-text search ---------------------------------------------
-- One searchable row per item. The index is rebuilt after scans and refreshed
-- for individual titles after hydration or a manual match. FTS5 gives prefix
-- search and bm25 ranking without loading the whole catalog into JS.

CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(
  item_id UNINDEXED,
  name,
  sort_title,
  parent_title,
  overview,
  genres,
  people,
  tokenize = 'unicode61 remove_diacritics 2'
);
