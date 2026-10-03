-- Sxema v1. Bitta foydalanuvchi — user_id ustuni yo'q.
-- Sanalar ISO 8601 UTC satri sifatida saqlanadi: '2026-10-01T10:00:00.000Z'.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- deleted_at: vazifa "o'chirilganda" hisobot tarixi saqlanib qolishi uchun yumshoq o'chirish.
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL CHECK (type IN ('doimiy', 'kunlik', 'haftalik', 'oylik')),
  importance  INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
  deadline    TEXT,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX tasks_deleted_idx ON tasks (deleted_at);

-- Har bir bajarilish alohida yozuv: kunlik vazifa — har kun uchun, haftalik — har hafta uchun...
-- Hisobotlar va "o'sish dinamikasi" shu tarixdan hisoblanadi.
CREATE TABLE task_completions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  period_key   TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (task_id, period_key)
);

CREATE INDEX task_completions_task_idx ON task_completions (task_id);
