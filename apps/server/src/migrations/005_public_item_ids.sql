-- 005 · Opaque public title identifiers -------------------------------------
-- Keep integer primary keys internal while using stable, non-sequential values
-- in title page URLs.

ALTER TABLE items ADD COLUMN public_id TEXT;

UPDATE items
SET public_id = substr(lower(hex(randomblob(16))), 1, 21)
WHERE public_id IS NULL;

CREATE UNIQUE INDEX items_public_id ON items(public_id);

CREATE TRIGGER items_public_id_insert
AFTER INSERT ON items
WHEN NEW.public_id IS NULL
BEGIN
  UPDATE items
  SET public_id = substr(lower(hex(randomblob(16))), 1, 21)
  WHERE id = NEW.id;
END;
