import type { Context } from 'grammy';
import { getGeminiCredentials } from '../ai/config.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import { formatStatusLabel } from '../db/stateMachine.js';
import {
  getGitHubCredentials,
  getWhitelistedRepos,
  validateGitHubToken,
} from '../github/auth.js';
import { listAccessibleRepos } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import { formatScheduleDays } from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import { buildReminderKeyboard, buildReminderMessage } from './messages.js';
import { buildRepoSelectionKeyboard, setCachedRepos } from './repoKeyboard.js';

export interface BotActionDeps {
  config: AppConfig;
  logger: Logger;
  repo: ReportRepo;
  getScheduler: () => SchedulerService;
}

/**
 * Menampilkan status laporan hari ini & koneksi sistem.
 */
export async function handleStatusAction(ctx: Context, deps: BotActionDeps): Promise<void> {
  const today = getTodayWibDate();
  const report = await deps.repo.getTodayReport(today);
  const schedule = deps.getScheduler().getCurrentSchedule();
  const creds = await getGitHubCredentials(deps.config, deps.repo);
  const whitelist = await getWhitelistedRepos(deps.config, deps.repo);
  const gemini = await getGeminiCredentials(deps.config, deps.repo);
  const statusText = report
    ? formatStatusLabel(report.status)
    : 'Belum ada aktivitas hari ini';

  const lines = [
    '📊 *Status Bot & Laporan*',
    `• Tanggal (WIB): \`${today}\``,
    `• Status laporan: *${statusText}*`,
    `• Jadwal: *${schedule.time} WIB* (${formatScheduleDays(schedule.days)})`,
    `• GitHub: ${creds ? `✅ Terhubung (\`${creds.username || 'token aktif'}\`)` : '❌ Belum terhubung (`/github`)'}`,
    `• Repo whitelist: *${whitelist.length} repo*`,
    `• Gemini AI: ${gemini ? `✅ Siap (\`${gemini.model}\`)` : '❌ Belum diatur (`/gemini`)'}`,
    `• Mode Dry Run Monev: \`${deps.config.DRY_RUN ? 'aktif' : 'nonaktif'}\``,
  ];

  if (report?.error) {
    lines.push(`• Error terakhir: \`${report.error}\``);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

/**
 * Menampilkan 7 riwayat laporan terakhir.
 */
export async function handleRiwayatAction(ctx: Context, deps: BotActionDeps): Promise<void> {
  const reports = await deps.repo.getRecentReports(7);

  if (reports.length === 0) {
    await ctx.reply('🗂️ Belum ada riwayat laporan tersimpan di database.');
    return;
  }

  const rows = reports.map(
    (r) => `• \`${r.date}\` — ${formatStatusLabel(r.status)}`,
  );

  await ctx.reply(['🗂️ *7 Laporan Terakhir*', '', ...rows].join('\n'), {
    parse_mode: 'Markdown',
  });
}

/**
 * Mengirim tombol pengingat harian (/tes atau menu Mulai Laporan).
 */
export async function handleTesAction(ctx: Context, deps: BotActionDeps): Promise<void> {
  const today = getTodayWibDate();
  const existing = await deps.repo.getTodayReport(today);

  if (existing?.status === 'terkirim') {
    await ctx.reply(
      `ℹ️ Laporan tanggal \`${today}\` sudah berstatus *${formatStatusLabel(existing.status)}*.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  if (
    existing &&
    (existing.status === 'dilewati' ||
      existing.status === 'gagal' ||
      existing.status === 'kedaluwarsa')
  ) {
    await deps.repo.resetNonSubmittedReport(today);
  }

  const sent = await ctx.reply(buildReminderMessage(today), {
    parse_mode: 'Markdown',
    reply_markup: buildReminderKeyboard(),
  });

  await deps.repo.createOrGetTodayReport(today, sent.message_id);
}

/**
 * Menampilkan status akun GitHub dan cara menghubungkan.
 */
export async function handleGitHubStatusAction(ctx: Context, deps: BotActionDeps): Promise<void> {
  const creds = await getGitHubCredentials(deps.config, deps.repo);
  if (creds) {
    try {
      const info = await validateGitHubToken(creds.token);
      await ctx.reply(
        [
          '🐙 *Status Akun GitHub*',
          `• Status: ✅ *Terhubung*`,
          `• Username: \`${info.login}\`${info.name ? ` (${info.name})` : ''}`,
          '',
          'Gunakan `/repo` untuk memilih repository whitelist.',
          'Gunakan `/github logout` untuk memutus koneksi.',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      return;
    } catch {
      await ctx.reply(
        '⚠️ Token GitHub tersimpan tapi sudah tidak valid. Hubungkan ulang via `/github login` atau `/github token <PAT>`.',
        { parse_mode: 'Markdown' },
      );
      return;
    }
  }

  await ctx.reply(
    [
      '🐙 *Akun GitHub belum terhubung*',
      '',
      'Cara menghubungkan:',
      '1. *Login via Browser (OAuth Device Flow — bisa pakai akun Google GitHub):*',
      '   Kirim `/github login` (butuh `GITHUB_CLIENT_ID` di `.env`)',
      '2. *Pakai Fine-grained PAT (langsung tanpa OAuth App):*',
      '   Kirim `/github token <PAT_KAMU>`',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

/**
 * Menampilkan keyboard interaktif pemilih repository GitHub.
 */
export async function handleRepoListAction(ctx: Context, deps: BotActionDeps): Promise<void> {
  const creds = await getGitHubCredentials(deps.config, deps.repo);
  if (!creds) {
    await ctx.reply(
      '❌ Akun GitHub belum terhubung. Kirim `/github` terlebih dahulu.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  try {
    const accessible = await listAccessibleRepos(creds.token);
    if (accessible.length === 0) {
      await ctx.reply('ℹ️ Tidak ada repository yang dapat diakses oleh token GitHub ini.');
      return;
    }

    setCachedRepos(accessible);
    const whitelisted = await getWhitelistedRepos(deps.config, deps.repo);
    const { keyboard, totalPages, currentPage } = buildRepoSelectionKeyboard(
      accessible,
      whitelisted,
      0,
    );

    await ctx.reply(
      `📚 *Pilih Repository Whitelist* (Halaman ${currentPage + 1}/${totalPages})\nAktif saat ini: *${whitelisted.length} repo*\n\nKlik tombol untuk mengaktifkan/menonaktifkan:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await ctx.reply(`❌ Gagal mengambil daftar repo GitHub: ${msg}`);
  }
}

/**
 * Menampilkan status konfigurasi Gemini AI dan cara mengaturnya.
 */
export async function handleGeminiStatusAction(ctx: Context, deps: BotActionDeps): Promise<void> {
  const gemini = await getGeminiCredentials(deps.config, deps.repo);

  if (gemini) {
    await ctx.reply(
      [
        '🧠 *Status Gemini AI*',
        '• Status: ✅ *Siap digunakan*',
        `• Model aktif: \`${gemini.model}\``,
        '',
        'Perintah pengaturan:',
        '• `/gemini key <API_KEY>` — Ganti API key',
        '• `/gemini model <NAMA_MODEL>` — Ganti model (mis. `gemini-3.8-flash`)',
        '• `/gemini hapus` — Hapus API key dinamis dari database',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  await ctx.reply(
    [
      '🧠 *Gemini API Key belum diatur*',
      '',
      'Cara mengatur langsung dari Telegram:',
      '1. Buat API key di Google AI Studio (`aistudio.google.com/apikey`)',
      '2. Kirim `/gemini key <API_KEY_KAMU>` ke bot ini',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}
