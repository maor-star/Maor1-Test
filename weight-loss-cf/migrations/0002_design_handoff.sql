-- Waist measurement on weigh-ins, editorial fields on articles, and the seeded library.
ALTER TABLE weekly_weigh_ins ADD COLUMN waist REAL;
ALTER TABLE posts ADD COLUMN slug TEXT;
ALTER TABLE posts ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN excerpt TEXT NOT NULL DEFAULT '';
ALTER TABLE posts ADD COLUMN read_minutes INTEGER NOT NULL DEFAULT 5;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
