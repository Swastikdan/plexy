-- Encoded password hashes from older provisioning/import paths may have been
-- bound as SQLite BLOBs despite the TEXT column declaration. Preserve every
-- byte of the encoded hash while normalizing its storage type; no password,
-- session, pairing key, account, or library is reset.
UPDATE users
SET password_hash = CAST(password_hash AS TEXT)
WHERE typeof(password_hash) = 'blob'
  AND (CAST(password_hash AS TEXT) GLOB '$argon2*'
       OR CAST(password_hash AS TEXT) GLOB '$2*');
