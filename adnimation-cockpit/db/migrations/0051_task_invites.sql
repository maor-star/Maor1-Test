-- Letting somebody in, by email, without an administrator.
--
-- Granting access already worked and still got nobody in, because a grant is
-- only half a door: the cockpit had exactly one way to sign in — the password
-- provider, which accepts the owner address and nothing else — and Google
-- OAuth is not configured on this server, so the button is not even drawn. A
-- granted colleague had a row in task_access, a role the middleware would have
-- honoured, and no way on earth to obtain a session.
--
-- So an invitation carries a one-time link, the person sets their own password
-- behind it, and that password is what they sign in with. No OAuth client, no
-- admin console, no second system.

CREATE TABLE IF NOT EXISTS task_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  name         TEXT,
  level        TEXT NOT NULL DEFAULT 'view',
  -- The task the invitation is about, when it was sent from one. Kept as a
  -- reference rather than copied, so the mail and the board tell one story;
  -- the invitation survives the task being archived.
  task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
  -- Only the hash. A link in somebody's inbox is a credential, and a table
  -- that stores the credential itself hands over every pending invitation to
  -- anyone who can read one row.
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   TEXT NOT NULL,
  note         TEXT,
  sent_at      TIMESTAMPTZ,
  send_error   TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_invites_email ON task_invites(lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- The account an invited person builds for themselves.
--
-- Deliberately NOT the users table: that one is the two real accounts, with a
-- role that reads the whole cockpit. This holds a password and nothing else,
-- and it opens exactly one door — whatever task_access currently says, checked
-- again on every sign-in, so revoking a grant locks them out the same minute.
CREATE TABLE IF NOT EXISTS collaborator_logins (
  email          TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  invite_id      UUID REFERENCES task_invites(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);
