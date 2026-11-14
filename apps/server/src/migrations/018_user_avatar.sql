-- Profile photos are stored as small, pre-compressed data URLs so every client
-- can render them without another authenticated image endpoint.
ALTER TABLE users ADD COLUMN avatar TEXT;
