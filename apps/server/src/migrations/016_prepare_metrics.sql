-- 016 · Preparation speed, ETA and start time -------------------------------
-- The player needs more than a bare percentage while a file is being prepared:
-- a repack reports the source clock, FFmpeg's own speed factor, and the derived
-- remaining time. `optimized_started_at` lets diagnostics tell a queued job
-- apart from one that has been running for minutes.

ALTER TABLE media_files ADD COLUMN optimized_speed REAL;
ALTER TABLE media_files ADD COLUMN optimized_eta_seconds INTEGER;
ALTER TABLE media_files ADD COLUMN optimized_started_at TEXT;
