ALTER TABLE pixie_items ADD COLUMN payment_due_at timestamptz DEFAULT (now() + interval '24 hours');
-- Existing imported records have no known invoice issue time.
UPDATE pixie_items SET payment_due_at=NULL;
CREATE TABLE pixie_faq (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, question text NOT NULL, answer text NOT NULL);
CREATE TABLE pixie_merch (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL, price bigint NOT NULL CHECK(price>=0), image_key text NOT NULL, available boolean NOT NULL DEFAULT true);
CREATE TABLE pixie_payments (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_id bigint NOT NULL REFERENCES pixie_items(id), buyer_email text NOT NULL, file_key text NOT NULL, mime text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), created_at timestamptz NOT NULL DEFAULT now(), sheet_synced boolean NOT NULL DEFAULT false);
CREATE TABLE pixie_push (endpoint text PRIMARY KEY, user_id text NOT NULL, email text NOT NULL, subscription jsonb NOT NULL);
CREATE TABLE pixie_notice_deliveries (notice_key text NOT NULL, endpoint text NOT NULL REFERENCES pixie_push(endpoint) ON DELETE CASCADE, PRIMARY KEY(notice_key,endpoint));

-- Web Push signing keys remain server-only; browsers receive the public key only.
CREATE TABLE pixie_push_config (id integer PRIMARY KEY CHECK(id=1), public_key text NOT NULL, private_key text NOT NULL);
