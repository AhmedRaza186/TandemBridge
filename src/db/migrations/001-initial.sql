-- TandemBridge task/state model (Phase 2).
-- Additive only: the existing `messages` table is untouched.
-- Statements are separated by a line containing exactly --;;
-- (a plain ';' split would break the trigger body).

-- Already present in the live DB; declared so a fresh test DB matches it.
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender      TEXT NOT NULL,
  receiver    TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'unread',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

--;;

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT    NOT NULL,
  seq           INTEGER NOT NULL,
  assignee      TEXT    NOT NULL,                   -- 'claude' | 'antigravity' (open on purpose)
  kind          TEXT    NOT NULL,                   -- e.g. 'implement', 'document', 'review'
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','ready','claimed','done','failed')),
  payload_json  TEXT    NOT NULL DEFAULT '{}'
                        CHECK (json_valid(payload_json)),
  result_json   TEXT    CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  claimed_at    TEXT,
  completed_at  TEXT,
  UNIQUE (workflow_id, seq)
);

--;;

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  agent       TEXT    NOT NULL,
  type        TEXT    NOT NULL,                     -- 'claimed','progress','completed','failed','handoff'
  data_json   TEXT    CHECK (data_json IS NULL OR json_valid(data_json)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

--;;

-- Queue lookup: "next ready task for agent X", and status rollups per agent.
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks (assignee, status, seq);

--;;

-- Event tail per task. The orchestrator's "events since id N" is a PK range scan and needs no index.
CREATE INDEX IF NOT EXISTS idx_events_task ON events (task_id, id);

--;;

-- Deterministic state machine, enforced in the DB so that either agent writing raw SQL
-- through the MCP server cannot produce an illegal transition.
CREATE TRIGGER IF NOT EXISTS trg_tasks_status_transition
BEFORE UPDATE OF status ON tasks
FOR EACH ROW
WHEN NEW.status <> OLD.status
 AND (OLD.status || '>' || NEW.status) NOT IN (
   'pending>ready', 'pending>failed',
   'ready>claimed', 'ready>pending',
   'claimed>done',  'claimed>failed', 'claimed>ready',
   'failed>ready'
 )
BEGIN
  SELECT RAISE(ABORT, 'illegal task status transition');
END;
