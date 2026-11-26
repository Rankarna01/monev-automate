-- Jalankan SQL ini di Supabase Dashboard -> SQL Editor
-- Mendukung Multi-User langsung via Telegram + Kuota Harian Gemini Global

CREATE TABLE IF NOT EXISTS settings (
  key_name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  telegram_username TEXT NULL,
  github_token_enc TEXT NULL,
  github_username TEXT NULL,
  whitelisted_repos JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule_time VARCHAR(5) NOT NULL DEFAULT '16:00',
  schedule_days JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  ai_usage_date VARCHAR(10) NULL,
  ai_usage_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  date VARCHAR(10) NOT NULL,
  status VARCHAR(32) NOT NULL,
  source_mode VARCHAR(20) NOT NULL DEFAULT 'github',
  manual_notes TEXT NULL,
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

-- Migrasi jika tabel reports sudah ada sebelumnya
ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_mode VARCHAR(20) NOT NULL DEFAULT 'github';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS manual_notes TEXT NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_date_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_user_id_date_key'
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_user_id_date_key UNIQUE (user_id, date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_user_date_desc ON reports (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users (telegram_chat_id);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE settings, users, reports TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
