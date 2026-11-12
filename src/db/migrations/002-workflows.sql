-- Workflow engine (v2). Applied once, guarded by PRAGMA user_version.
-- `tasks` is rebuilt because SQLite cannot alter a CHECK constraint. Rows are copied.
-- The `messages` mailbox is untouched.
-- Statements are separated by a line containing exactly --;;

DROP TRIGGER IF EXISTS trg_tasks_status_transition;

--;;

CREATE TABLE tasks_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT    NOT NULL,
  seq           INTEGER NOT NULL,
  assignee      TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','ready','claimed','paused','blocked','done','failed')),
  payload_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  result_json   TEXT    CHECK (result_json IS NULL OR json_valid(result_json)),
  depends_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(depends_json)),
  retries       INTEGER NOT NULL DEFAULT 0,
  base_sha      TEXT,
  resume_at     TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  claimed_at    TEXT,
  completed_at  TEXT,
  UNIQUE (workflow_id, seq)
);

--;;

INSERT INTO tasks_v2 (id, workflow_id, seq, assignee, kind, status, payload_json, result_json,
                      created_at, claimed_at, completed_at)
SELECT id, workflow_id, seq, assignee, kind, status, payload_json, result_json,
       created_at, claimed_at, completed_at
  FROM tasks;

--;;

DROP TABLE tasks;

--;;

ALTER TABLE tasks_v2 RENAME TO tasks;

--;;

CREATE INDEX idx_tasks_queue ON tasks (assignee, status, seq);

--;;

CREATE INDEX idx_tasks_status ON tasks (status, workflow_id, seq);

--;;

CREATE TRIGGER trg_tasks_status_transition
BEFORE UPDATE OF status ON tasks
FOR EACH ROW
WHEN NEW.status <> OLD.status
 AND (OLD.status || '>' || NEW.status) NOT IN (
   'pending>ready', 'pending>failed',
   'ready>claimed', 'ready>pending', 'ready>failed',
   'claimed>done',  'claimed>failed', 'claimed>ready', 'claimed>paused', 'claimed>blocked',
   'paused>ready',  'paused>failed',
   'blocked>ready', 'blocked>failed',
   'failed>ready'
 )
BEGIN
  SELECT RAISE(ABORT, 'illegal task status transition');
END;

--;;

CREATE TABLE IF NOT EXISTS workflows (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL,
  workspace     TEXT NOT NULL,
  branch        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','paused','blocked','done','failed')),
  spec_json     TEXT NOT NULL CHECK (json_valid(spec_json)),
  budget_usd    REAL NOT NULL,
  spent_usd     REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);

--;;

-- One row per channel. A message stays 'pending' until that channel accepts it,
-- so alerts survive an internet outage or a restart.
CREATE TABLE IF NOT EXISTS notifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  channel          TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_error       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at          TEXT,
  UNIQUE (channel, dedupe_key)
);

--;;

CREATE INDEX IF NOT EXISTS idx_notifications_due ON notifications (status, next_attempt_at);

--;;

CREATE TABLE IF NOT EXISTS system_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
