-- 003 · Re-probe existing files for embedded subtitles -------------------------
-- Mediabunny (used for probing) cannot demux subtitle tracks, so earlier scans
-- stored `subtitles_json = '[]'` even when a Matroska file carried S_TEXT/UTF8
-- tracks. Subtitle detection now reads the container directly; mark probed rows
-- pending so the next scan fills in the tracks and extracts them. Probe facts
-- for video/audio are simply rewritten; prepared copies are keyed by mtime and
-- stay valid.
UPDATE media_files
SET analysis_status = 'pending'
WHERE analysis_status = 'probed';

-- Extracted files from the old (broken) path may contain malformed cues; let
-- the next scan rebuild them.
DELETE FROM subtitle_cache;
