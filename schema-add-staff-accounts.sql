-- Per-staff login accounts. Replaces the single shared admin password +
-- free-text "Working as" actor field: every write in the system used to be
-- attributable only to whoever knew the one password, self-reporting a name
-- nobody verified. Now each login is its own account, and the actor on every
-- write is the authenticated session's name, not a client-supplied string.
CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
