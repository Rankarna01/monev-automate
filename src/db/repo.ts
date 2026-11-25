import type { Pool, RowDataPacket } from 'mysql2/promise';
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
  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
}

interface ReportRow extends RowDataPacket, ReportRecord {}

interface SettingRow extends RowDataPacket {
  key_name: string;
  value: string;
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
 * Membuat repository query untuk tabel `reports` dan `settings` di MySQL.
 */
export function createReportRepo(pool: Pool): ReportRepo {
  async function getTodayReport(date: string): Promise<ReportRecord | null> {
    const [rows] = await pool.query<ReportRow[]>(
      'SELECT * FROM reports WHERE date = ? LIMIT 1',
      [date],
    );
    return rows[0] ?? null;
  }

  async function createOrGetTodayReport(
    date: string,
    telegramMessageId?: number,
  ): Promise<ReportRecord> {
    const existing = await getTodayReport(date);
    if (existing) {
      if (telegramMessageId !== undefined && existing.telegram_message_id !== telegramMessageId) {
        await pool.query(
          'UPDATE reports SET telegram_message_id = ? WHERE date = ?',
          [telegramMessageId, date],
        );
        return (await getTodayReport(date))!;
      }
      return existing;
    }

    await pool.query(
      `INSERT INTO reports (date, status, telegram_message_id)
       VALUES (?, 'menunggu_trigger', ?)`,
      [date, telegramMessageId ?? null],
    );

    return (await getTodayReport(date))!;
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

    const submittedAtClause = nextStatus === 'terkirim' ? ', submitted_at = NOW()' : '';
    const nextError = extra?.error !== undefined ? extra.error : current.error;
    const nextMsgId =
      extra?.telegramMessageId !== undefined
        ? extra.telegramMessageId
        : current.telegram_message_id;

    await pool.query(
      `UPDATE reports
       SET status = ?, error = ?, telegram_message_id = ?${submittedAtClause}
       WHERE date = ?`,
      [nextStatus, nextError, nextMsgId, date],
    );

    return (await getTodayReport(date))!;
  }

  async function saveDraft(date: string, draft: DraftInput): Promise<ReportRecord> {
    const current = await getTodayReport(date);
    if (!current) {
      throw new Error(`Laporan untuk tanggal ${date} tidak ditemukan`);
    }

    assertValidTransition(current.status, 'draf_siap');

    await pool.query(
      `UPDATE reports
       SET status = 'draf_siap',
           commits_json = COALESCE(?, commits_json),
           aktivitas = ?,
           pembelajaran = ?,
           kendala = ?,
           telegram_message_id = COALESCE(?, telegram_message_id),
           error = NULL
       WHERE date = ?`,
      [
        draft.commitsJson ?? null,
        draft.aktivitas,
        draft.pembelajaran,
        draft.kendala,
        draft.telegramMessageId ?? null,
        date,
      ],
    );

    return (await getTodayReport(date))!;
  }

  async function saveCommits(date: string, commitsJson: string): Promise<ReportRecord> {
    await pool.query(
      'UPDATE reports SET commits_json = ? WHERE date = ?',
      [commitsJson, date],
    );
    return (await getTodayReport(date))!;
  }

  async function getRecentReports(limit: number = 7): Promise<ReportRecord[]> {
    const [rows] = await pool.query<ReportRow[]>(
      'SELECT * FROM reports ORDER BY date DESC LIMIT ?',
      [limit],
    );
    return rows;
  }

  async function getSetting(key: string): Promise<string | null> {
    const [rows] = await pool.query<SettingRow[]>(
      'SELECT key_name, value FROM settings WHERE key_name = ? LIMIT 1',
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async function setSetting(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO settings (key_name, value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, value],
    );
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
