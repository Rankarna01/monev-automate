import type { SupabaseClient } from '@supabase/supabase-js';
import { assertValidTransition, type ReportStatus } from './stateMachine.js';

export interface ReportRecord {
  id: number;
  date: string;
  status: ReportStatus;
  commits_json: string | null;
  aktivitas: string | null;
  pembelajaran: string | null;
  kendala: string | null;
  telegram_message_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface DraftInput {
  commitsJson?: string;
  aktivitas: string;
  pembelajaran: string;
  kendala: string;
  telegramMessageId?: number;
}

export interface ReportRepo {
  getTodayReport: (date: string) => Promise<ReportRecord | null>;
  createOrGetTodayReport: (
    date: string,
    telegramMessageId?: number,
  ) => Promise<ReportRecord>;
  updateStatus: (
    date: string,
    nextStatus: ReportStatus,
    extra?: {
      error?: string | null;
      telegramMessageId?: number | null;
    },
  ) => Promise<ReportRecord>;
  saveDraft: (date: string, draft: DraftInput) => Promise<ReportRecord>;
  saveCommits: (date: string, commitsJson: string) => Promise<ReportRecord>;
  getRecentReports: (limit?: number) => Promise<ReportRecord[]>;
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;
}

/**
 * Membuat repository query untuk tabel `reports` dan `settings` di Supabase.
 */
export function createReportRepo(client: SupabaseClient): ReportRepo {
  async function getTodayReport(date: string): Promise<ReportRecord | null> {
    const { data, error } = await client
      .from('reports')
      .select('*')
      .eq('date', date)
      .maybeSingle();

    if (error) {
      throw new Error(`Gagal membaca laporan ${date}: ${error.message}`);
    }

    return (data as ReportRecord | null) ?? null;
  }

  async function createOrGetTodayReport(
    date: string,
    telegramMessageId?: number,
  ): Promise<ReportRecord> {
    const existing = await getTodayReport(date);
    if (existing) {
      if (
        telegramMessageId !== undefined &&
        existing.telegram_message_id !== telegramMessageId
      ) {
        const { data, error } = await client
          .from('reports')
          .update({
            telegram_message_id: telegramMessageId,
            updated_at: new Date().toISOString(),
          })
          .eq('date', date)
          .select('*')
          .single();

        if (error) {
          throw new Error(`Gagal memperbarui message_id: ${error.message}`);
        }
        return data as ReportRecord;
      }
      return existing;
    }

    const { data, error } = await client
      .from('reports')
      .insert({
        date,
        status: 'menunggu_trigger',
        telegram_message_id: telegramMessageId ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal membuat laporan ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function updateStatus(
    date: string,
    nextStatus: ReportStatus,
    extra?: {
      error?: string | null;
      telegramMessageId?: number | null;
    },
  ): Promise<ReportRecord> {
    const current = await getTodayReport(date);
    if (!current) {
      throw new Error(`Laporan untuk tanggal ${date} tidak ditemukan`);
    }

    assertValidTransition(current.status, nextStatus);

    const payload: Record<string, unknown> = {
      status: nextStatus,
      error: extra?.error !== undefined ? extra.error : current.error,
      telegram_message_id:
        extra?.telegramMessageId !== undefined
          ? extra.telegramMessageId
          : current.telegram_message_id,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === 'terkirim') {
      payload.submitted_at = new Date().toISOString();
    }

    const { data, error } = await client
      .from('reports')
      .update(payload)
      .eq('date', date)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal memperbarui status ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function saveDraft(date: string, draft: DraftInput): Promise<ReportRecord> {
    const current = await getTodayReport(date);
    if (!current) {
      throw new Error(`Laporan untuk tanggal ${date} tidak ditemukan`);
    }

    assertValidTransition(current.status, 'draf_siap');

    const { data, error } = await client
      .from('reports')
      .update({
        status: 'draf_siap',
        commits_json: draft.commitsJson ?? current.commits_json,
        aktivitas: draft.aktivitas,
        pembelajaran: draft.pembelajaran,
        kendala: draft.kendala,
        telegram_message_id:
          draft.telegramMessageId ?? current.telegram_message_id,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('date', date)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan draf ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function saveCommits(date: string, commitsJson: string): Promise<ReportRecord> {
    const { data, error } = await client
      .from('reports')
      .update({
        commits_json: commitsJson,
        updated_at: new Date().toISOString(),
      })
      .eq('date', date)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan commits ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function getRecentReports(limit: number = 7): Promise<ReportRecord[]> {
    const { data, error } = await client
      .from('reports')
      .select('*')
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Gagal mengambil riwayat laporan: ${error.message}`);
    }

    return (data as ReportRecord[] | null) ?? [];
  }

  async function getSetting(key: string): Promise<string | null> {
    const { data, error } = await client
      .from('settings')
      .select('value')
      .eq('key_name', key)
      .maybeSingle();

    if (error) {
      throw new Error(`Gagal membaca setting ${key}: ${error.message}`);
    }

    return (data as { value: string } | null)?.value ?? null;
  }

  async function setSetting(key: string, value: string): Promise<void> {
    const { error } = await client.from('settings').upsert(
      {
        key_name: key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key_name' },
    );

    if (error) {
      throw new Error(`Gagal menyimpan setting ${key}: ${error.message}`);
    }
  }

  return {
    getTodayReport,
    createOrGetTodayReport,
    updateStatus,
    saveDraft,
    saveCommits,
    getRecentReports,
    getSetting,
    setSetting,
  };
}
