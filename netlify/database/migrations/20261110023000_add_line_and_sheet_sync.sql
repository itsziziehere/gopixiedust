CREATE TABLE pixie_buyer_links (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id text NOT NULL UNIQUE, email text NOT NULL, line_name text NOT NULL,
 normalized_name text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE UNIQUE INDEX pixie_verified_line ON pixie_buyer_links(normalized_name) WHERE status='approved';
CREATE TABLE pixie_sheet_sync (id integer PRIMARY KEY CHECK(id=1), synced_at timestamptz, error text);
INSERT INTO pixie_sheet_sync(id) VALUES(1);
ALTER TABLE pixie_items ADD COLUMN sync_key text UNIQUE;
ALTER TABLE pixie_items ADD COLUMN source_buyer text;
ALTER TABLE pixie_items ADD COLUMN active boolean NOT NULL DEFAULT true;
UPDATE pixie_items SET source_buyer=data->>'buyer';
