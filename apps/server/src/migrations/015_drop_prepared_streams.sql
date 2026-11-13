-- 015 · Drop the adaptive HLS preparation pipeline -------------------------
-- Playback is direct-first: original files stream over HTTP range, and a
-- conversion only happens when a file cannot play. The per-title quality
-- ladder, its cached variant playlists, and their progress rows are gone.

DROP TABLE IF EXISTS hls_preparations;
DROP TABLE IF EXISTS item_stream_settings;
