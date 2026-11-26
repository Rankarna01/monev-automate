import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../utils/logger.js';

export interface DatabaseConnection {
  client: SupabaseClient;
  close: () => Promise<void>;
}

/**
 * Menginisialisasi koneksi Supabase dan memverifikasi tabel `settings`, `users`, serta `reports`.
 */
export async function initDatabase(
  config: AppConfig,
  logger: Logger,
): Promise<DatabaseConnection> {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di file .env.',
    );
  }

  const client = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  for (const table of ['settings', 'users', 'reports'] as const) {
    const { error } = await client.from(table).select('*').limit(1);
    if (error) {
      throw new Error(
        `Tabel "${table}" di Supabase belum siap (${error.message}). Jalankan isi file supabase/schema.sql di Supabase SQL Editor terlebih dahulu.`,
      );
    }
  }

  logger.info({ supabaseUrl: config.SUPABASE_URL }, 'Database Supabase terhubung');

  return {
    client,
    close: async () => {},
  };
}
