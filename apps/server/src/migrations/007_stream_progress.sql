-- 007 · Adaptive stream generation progress ---------------------------------
ALTER TABLE hls_preparations ADD COLUMN progress REAL NOT NULL DEFAULT 0;
