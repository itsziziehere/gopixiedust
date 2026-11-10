CREATE TABLE pixie_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id text NOT NULL,
 display_name text NOT NULL DEFAULT 'Buyer Pixiedust',
 caption text NOT NULL DEFAULT '',
 image_key text,
 owner_rating integer NOT NULL CHECK(owner_rating BETWEEN 1 AND 5),
 admin_rating integer NOT NULL CHECK(admin_rating BETWEEN 1 AND 5),
 shipping_rating integer NOT NULL CHECK(shipping_rating BETWEEN 1 AND 5),
 packing_rating integer NOT NULL CHECK(packing_rating BETWEEN 1 AND 5),
 information_rating integer NOT NULL CHECK(information_rating BETWEEN 1 AND 5),
 visible boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(caption<>'' OR image_key IS NOT NULL)
);
CREATE INDEX pixie_reviews_user_created ON pixie_reviews(user_id,created_at);
CREATE TABLE pixie_chat_threads (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 session_hash text NOT NULL UNIQUE,
 origin_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pixie_chat_origin_created ON pixie_chat_threads(origin_hash,created_at);
CREATE TABLE pixie_chat_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 thread_id bigint NOT NULL REFERENCES pixie_chat_threads(id),
 sender text NOT NULL CHECK(sender IN ('buyer','owner')),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pixie_chat_messages_thread ON pixie_chat_messages(thread_id,id);
CREATE TABLE pixie_owner_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_key text NOT NULL UNIQUE,
 kind text NOT NULL,
 title text NOT NULL,
 body text NOT NULL,
 thread_id bigint REFERENCES pixie_chat_threads(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
