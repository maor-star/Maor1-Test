-- Credentials he can set himself, without a deploy.
--
-- Until now every key lived in the instance's .env and only reached it through
-- deploy/set-secret.mjs from a machine with AWS access. That is right for the
-- keys that existed before the app did — the database URL, the auth secret —
-- and wrong for the ones he acquires while using it: a LinkedIn token, a
-- Lovable key, whatever comes next. Those he should be able to paste in.
--
-- The value is encrypted at rest with AES-256-GCM under a key derived from
-- AUTH_SECRET, which is not in this table and not in this database. A dump of
-- this table is therefore not a set of credentials. The value is never sent
-- back to a browser: the screen shows whether a key is set, when, and its last
-- four characters, and nothing else.

create table if not exists app_secrets (
  key         text primary key,
  -- iv:tag:ciphertext, all base64. See lib/secrets/store.ts.
  value_enc   text not null,
  -- The last four characters, in clear, so he can tell two keys apart without
  -- being shown either.
  hint        text,
  updated_at  timestamptz not null default now(),
  updated_by  text not null
);
