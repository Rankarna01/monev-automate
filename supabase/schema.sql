-- Jalankan SQL ini di Supabase Dashboard -> SQL Editor

CREATE TABLE IF NOT EXISTS settings (
  key_name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  commits_json TEXT NULL,
  aktivitas TEXT NULL,
  pembelajaran TEXT NULL,
  kendala TEXT NULL,
  telegram_message_id BIGINT NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_date_desc ON reports (date DESC);
