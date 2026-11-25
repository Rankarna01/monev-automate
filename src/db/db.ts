import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../utils/logger.js';

export interface DatabaseConnection {
  client: SupabaseClient;
  close: () => Promise<void>;
}

/**
 * Menginisialisasi koneksi Supabase dan memverifikasi tabel `settings` serta `reports` sudah dibuat.
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

  // Verifikasi tabel sudah dibuat lewat supabase/schema.sql
  const { error: settingsError } = await client
    .from('settings')
    .select('key_name')
    .limit(1);

  if (settingsError) {
    throw new Error(
      `Tabel Supabase belum siap (${settingsError.message}). Jalankan isi file supabase/schema.sql di Supabase SQL Editor terlebih dahulu.`,
    );
  }

  const { error: reportsError } = await client
    .from('reports')
    .select('id')
    .limit(1);

  if (reportsError) {
    throw new Error(
      `Tabel reports Supabase belum siap (${reportsError.message}). Jalankan isi file supabase/schema.sql di Supabase SQL Editor terlebih dahulu.`,
    );
  }

  logger.info({ supabaseUrl: config.SUPABASE_URL }, 'Database Supabase terhubung');

  return {
    client,
    close: async () => {
      // Supabase client berbasis HTTP stateless, tidak perlu menutup pool koneksi
    },
  };
}
