const { Pool } = require('pg');

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id                       SERIAL PRIMARY KEY,
    full_name                VARCHAR(100) NOT NULL,
    email                    VARCHAR(255) NOT NULL UNIQUE,
    password_hash            VARCHAR(255) NOT NULL,
    telegram_chat_id         VARCHAR(32) UNIQUE,
    telegram_link_code       VARCHAR(32),
    telegram_link_expires_at TIMESTAMPTZ,
    reminder_min_importance  INTEGER NOT NULL DEFAULT 8,
    last_hourly_reminder_at  TIMESTAMPTZ,
    all_done_notified_on     VARCHAR(10),
    last_summary_on          VARCHAR(10),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- deleted_at: vazifa "o'chirilganda" hisobot tarixi saqlanib qolishi uchun yumshoq o'chirish.
  CREATE TABLE IF NOT EXISTS tasks (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type        VARCHAR(10) NOT NULL CHECK (type IN ('doimiy', 'kunlik', 'haftalik', 'oylik')),
    importance  INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
    deadline    TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);

  -- Har bir bajarilish alohida yozuv: kunlik vazifa — har kun uchun, haftalik — har hafta uchun...
  -- Hisobotlar va "o'sish dinamikasi" shu tarixdan hisoblanadi.
  CREATE TABLE IF NOT EXISTS task_completions (
    id           SERIAL PRIMARY KEY,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    period_key   VARCHAR(20) NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, period_key)
  );

  CREATE INDEX IF NOT EXISTS task_completions_task_idx ON task_completions (task_id);

  -- Bir xil ogohlantirish (deadline yaqin/o'tdi) ikki marta yuborilmasligi uchun jurnal.
  CREATE TABLE IF NOT EXISTS reminder_log (
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind       VARCHAR(20) NOT NULL,
    period_key VARCHAR(40) NOT NULL,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, kind, period_key)
  );
`;

// Ulanish parametrlari PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT env'laridan olinadi.
// URL o'rniga alohida env: parolda maxsus belgi bo'lsa ham URL-encoding muammosi bo'lmaydi.
function createPool() {
  return new Pool({ max: 10 });
}

async function migrate(pool) {
  await pool.query(SCHEMA_SQL);
}

// Postgres konteyneri backend'dan kechroq tayyor bo'lishi mumkin — bir necha marta urinamiz.
async function waitForDatabase(pool, { attempts = 30, delayMs = 2000, log = console.log } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      log(`Baza hali tayyor emas (${i}/${attempts}): ${err.message}`);
      if (i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { createPool, migrate, waitForDatabase, SCHEMA_SQL };
