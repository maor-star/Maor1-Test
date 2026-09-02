-- A picture for the post.
--
-- Gemini draws it from a prompt he typed, or from one the cockpit derives from
-- the post itself. It is stored here rather than on disk or in a bucket
-- because there is one of them per post, a post is a few a month, and a
-- picture that lives beside the words it belongs to cannot be lost by a
-- redeploy or an S3 policy. Served back only through an authenticated route.

alter table marketing_posts
  add column if not exists image        bytea,
  add column if not exists image_mime   text,
  add column if not exists image_prompt text,
  add column if not exists image_at     timestamptz;
