import type { SupabaseClient } from '@supabase/supabase-js';
import { assertValidTransition, type ReportStatus } from './stateMachine.js';

export type SourceMode = 'github' | 'manual_ai' | 'hybrid';

export interface UserRecord {
  id: number;
  telegram_chat_id: number;
  display_name: string;
  telegram_username: string | null;
  github_token_enc: string | null;
  github_username: string | null;
  whitelisted_repos: string[];
  schedule_time: string;
  schedule_days: number[];
  ai_usage_date: string | null;
  ai_usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface AiQuotaStatus {
  used: number;
  limit: number;
  remaining: number;
}

export interface ReportRecord {
  id: number;
  user_id: number;
  date: string;
  status: ReportStatus;
  source_mode: SourceMode;
  manual_notes: string | null;
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
  sourceMode?: SourceMode;
  manualNotes?: string | null;
  commitsJson?: string;
  aktivitas: string;
  pembelajaran: string;
  kendala: string;
  telegramMessageId?: number;
}

export interface ReportRepo {
  // User management
  upsertUser: (input: {
    telegramChatId: number;
    displayName: string;
    telegramUsername?: string | null;
  }) => Promise<{ user: UserRecord; isNew: boolean }>;
  getUserByChatId: (chatId: number) => Promise<UserRecord | null>;
  getAllUsers: () => Promise<UserRecord[]>;
  updateUserGitHub: (
    userId: number,
    data: { tokenEnc: string | null; username: string | null },
  ) => Promise<UserRecord>;
  updateUserRepos: (userId: number, repos: string[]) => Promise<UserRecord>;
  updateUserSchedule: (
    userId: number,
    data: { time?: string; days?: number[] },
  ) => Promise<UserRecord>;

  // AI Quota
  getAiQuotaStatus: (
    userId: number,
    todayDate: string,
    dailyLimit: number,
  ) => Promise<AiQuotaStatus>;
  consumeAiQuota: (
    userId: number,
    todayDate: string,
    dailyLimit: number,
  ) => Promise<AiQuotaStatus>;

  // Reports per user
  getTodayReport: (userId: number, date: string) => Promise<ReportRecord | null>;
  createOrGetTodayReport: (
    userId: number,
    date: string,
    telegramMessageId?: number,
    sourceMode?: SourceMode,
  ) => Promise<ReportRecord>;
  updateStatus: (
    userId: number,
    date: string,
    nextStatus: ReportStatus,
    extra?: {
      error?: string | null;
      telegramMessageId?: number | null;
      sourceMode?: SourceMode;
      manualNotes?: string | null;
    },
  ) => Promise<ReportRecord>;
  saveDraft: (
    userId: number,
    date: string,
    draft: DraftInput,
  ) => Promise<ReportRecord>;
  saveCommits: (
    userId: number,
    date: string,
    commitsJson: string,
  ) => Promise<ReportRecord>;
  resetNonSubmittedReport: (
    userId: number,
    date: string,
  ) => Promise<ReportRecord | null>;
  getRecentReports: (userId: number, limit?: number) => Promise<ReportRecord[]>;

  // Global settings
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;
}

/**
 * Membuat repository query multi-user untuk tabel `users`, `reports`, dan `settings` di Supabase.
 */
export function createReportRepo(client: SupabaseClient): ReportRepo {
  async function getUserByChatId(chatId: number): Promise<UserRecord | null> {
    const { data, error } = await client
      .from('users')
      .select('*')
      .eq('telegram_chat_id', chatId)
      .maybeSingle();

    if (error) {
      throw new Error(`Gagal membaca user ${chatId}: ${error.message}`);
    }
    return (data as UserRecord | null) ?? null;
  }

  async function upsertUser(input: {
    telegramChatId: number;
    displayName: string;
    telegramUsername?: string | null;
  }): Promise<{ user: UserRecord; isNew: boolean }> {
    const existing = await getUserByChatId(input.telegramChatId);
    if (existing) {
      if (
        existing.display_name !== input.displayName ||
        existing.telegram_username !== (input.telegramUsername ?? null)
      ) {
        const { data, error } = await client
          .from('users')
          .update({
            display_name: input.displayName,
            telegram_username: input.telegramUsername ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('*')
          .single();

        if (error) {
          throw new Error(`Gagal memperbarui profil user: ${error.message}`);
        }
        return { user: data as UserRecord, isNew: false };
      }
      return { user: existing, isNew: false };
    }

    const { data, error } = await client
      .from('users')
      .insert({
        telegram_chat_id: input.telegramChatId,
        display_name: input.displayName,
        telegram_username: input.telegramUsername ?? null,
        whitelisted_repos: [],
        schedule_time: '16:00',
        schedule_days: [1, 2, 3, 4, 5],
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal mendaftarkan user baru: ${error.message}`);
    }

    return { user: data as UserRecord, isNew: true };
  }

  async function getAllUsers(): Promise<UserRecord[]> {
    const { data, error } = await client
      .from('users')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Gagal mengambil daftar user: ${error.message}`);
    }
    return (data as UserRecord[] | null) ?? [];
  }

  async function updateUserGitHub(
    userId: number,
    data: { tokenEnc: string | null; username: string | null },
  ): Promise<UserRecord> {
    const { data: updated, error } = await client
      .from('users')
      .update({
        github_token_enc: data.tokenEnc,
        github_username: data.username,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan akun GitHub user: ${error.message}`);
    }
    return updated as UserRecord;
  }

  async function updateUserRepos(
    userId: number,
    repos: string[],
  ): Promise<UserRecord> {
    const normalized = Array.from(new Set(repos.map((r) => r.trim()).filter(Boolean)));
    const { data, error } = await client
      .from('users')
      .update({
        whitelisted_repos: normalized,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan repo whitelist: ${error.message}`);
    }
    return data as UserRecord;
  }

  async function updateUserSchedule(
    userId: number,
    data: { time?: string; days?: number[] },
  ): Promise<UserRecord> {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (data.time !== undefined) payload.schedule_time = data.time;
    if (data.days !== undefined) payload.schedule_days = data.days;

    const { data: updated, error } = await client
      .from('users')
      .update(payload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan jadwal user: ${error.message}`);
    }
    return updated as UserRecord;
  }

  async function getAiQuotaStatus(
    userId: number,
    todayDate: string,
    dailyLimit: number,
  ): Promise<AiQuotaStatus> {
    const { data, error } = await client
      .from('users')
      .select('ai_usage_date, ai_usage_count')
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error(`Gagal membaca kuota AI: ${error.message}`);
    }

    const used =
      data.ai_usage_date === todayDate ? Number(data.ai_usage_count ?? 0) : 0;
    const remaining = Math.max(0, dailyLimit - used);
    return { used, limit: dailyLimit, remaining };
  }

  async function consumeAiQuota(
    userId: number,
    todayDate: string,
    dailyLimit: number,
  ): Promise<AiQuotaStatus> {
    const status = await getAiQuotaStatus(userId, todayDate, dailyLimit);
    if (status.remaining <= 0) {
      throw new Error(
        `Kuota AI harian kamu (${status.used}/${dailyLimit}) sudah habis untuk hari ini. Kuota akan reset otomatis besok pukul 00:00 WIB.`,
      );
    }

    const nextUsed = status.used + 1;
    const { error } = await client
      .from('users')
      .update({
        ai_usage_date: todayDate,
        ai_usage_count: nextUsed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      throw new Error(`Gagal memperbarui kuota AI: ${error.message}`);
    }

    return {
      used: nextUsed,
      limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - nextUsed),
    };
  }

  async function getTodayReport(
    userId: number,
    date: string,
  ): Promise<ReportRecord | null> {
    const { data, error } = await client
      .from('reports')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();

    if (error) {
      throw new Error(`Gagal membaca laporan ${date}: ${error.message}`);
    }
    return (data as ReportRecord | null) ?? null;
  }

  async function createOrGetTodayReport(
    userId: number,
    date: string,
    telegramMessageId?: number,
    sourceMode: SourceMode = 'github',
  ): Promise<ReportRecord> {
    const existing = await getTodayReport(userId, date);
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
          .eq('id', existing.id)
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
        user_id: userId,
        date,
        status: 'menunggu_trigger',
        source_mode: sourceMode,
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
    userId: number,
    date: string,
    nextStatus: ReportStatus,
    extra?: {
      error?: string | null;
      telegramMessageId?: number | null;
      sourceMode?: SourceMode;
      manualNotes?: string | null;
    },
  ): Promise<ReportRecord> {
    const current = await getTodayReport(userId, date);
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
      source_mode:
        extra?.sourceMode !== undefined ? extra.sourceMode : current.source_mode,
      manual_notes:
        extra?.manualNotes !== undefined
          ? extra.manualNotes
          : current.manual_notes,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === 'terkirim') {
      payload.submitted_at = new Date().toISOString();
    }

    const { data, error } = await client
      .from('reports')
      .update(payload)
      .eq('id', current.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal memperbarui status ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function saveDraft(
    userId: number,
    date: string,
    draft: DraftInput,
  ): Promise<ReportRecord> {
    const current = await getTodayReport(userId, date);
    if (!current) {
      throw new Error(`Laporan untuk tanggal ${date} tidak ditemukan`);
    }

    assertValidTransition(current.status, 'draf_siap');

    const { data, error } = await client
      .from('reports')
      .update({
        status: 'draf_siap',
        source_mode: draft.sourceMode ?? current.source_mode,
        manual_notes:
          draft.manualNotes !== undefined
            ? draft.manualNotes
            : current.manual_notes,
        commits_json: draft.commitsJson ?? current.commits_json,
        aktivitas: draft.aktivitas,
        pembelajaran: draft.pembelajaran,
        kendala: draft.kendala,
        telegram_message_id:
          draft.telegramMessageId ?? current.telegram_message_id,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan draf ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function saveCommits(
    userId: number,
    date: string,
    commitsJson: string,
  ): Promise<ReportRecord> {
    const { data, error } = await client
      .from('reports')
      .update({
        commits_json: commitsJson,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('date', date)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal menyimpan commits ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function resetNonSubmittedReport(
    userId: number,
    date: string,
  ): Promise<ReportRecord | null> {
    const current = await getTodayReport(userId, date);
    if (!current) return null;
    if (current.status === 'terkirim') {
      throw new Error(
        `Laporan tanggal ${date} sudah terkirim dan tidak dapat direset.`,
      );
    }

    const { data, error } = await client
      .from('reports')
      .update({
        status: 'menunggu_trigger',
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Gagal mereset laporan ${date}: ${error.message}`);
    }

    return data as ReportRecord;
  }

  async function getRecentReports(
    userId: number,
    limit: number = 7,
  ): Promise<ReportRecord[]> {
    const { data, error } = await client
      .from('reports')
      .select('*')
      .eq('user_id', userId)
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
    upsertUser,
    getUserByChatId,
    getAllUsers,
    updateUserGitHub,
    updateUserRepos,
    updateUserSchedule,
    getAiQuotaStatus,
    consumeAiQuota,
    getTodayReport,
    createOrGetTodayReport,
    updateStatus,
    saveDraft,
    saveCommits,
    resetNonSubmittedReport,
    getRecentReports,
    getSetting,
    setSetting,
  };
}
