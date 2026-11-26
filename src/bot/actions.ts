import type { Context } from 'grammy';
import { getGeminiCredentials } from '../ai/config.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo, UserRecord } from '../db/repo.js';
import { formatStatusLabel } from '../db/stateMachine.js';
import { getUserGitHubCredentials, validateGitHubToken } from '../github/auth.js';
import { listAccessibleRepos } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import { formatScheduleDays } from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  buildReminderKeyboard,
  buildReminderMessage,
  buildTutorialMessage,
} from './messages.js';
import { buildRepoSelectionKeyboard, setCachedRepos } from './repoKeyboard.js';

export interface BotActionDeps {
  config: AppConfig;
  logger: Logger;
  repo: ReportRepo;
  getScheduler: () => SchedulerService;
}

/**
 * Memastikan pengirim terdaftar/diperbarui di tabel `users` dan mengembalikan UserRecord-nya.
 */
export async function resolveCurrentUser(
  ctx: Context,
  repo: ReportRepo,
): Promise<UserRecord | null> {
  const chatId = ctx.chat?.id;
  if (!chatId || !ctx.from) return null;

  const fullName = [ctx.from.first_name, ctx.from.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const displayName = fullName || ctx.from.username || `User ${chatId}`;

  const { user } = await repo.upsertUser({
    telegramChatId: chatId,
    displayName,
    telegramUsername: ctx.from.username ?? null,
  });

  return user;
}

/**
 * Menampilkan status laporan hari ini, identitas user, koneksi GitHub, & sisa kuota AI.
 */
export async function handleStatusAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const today = getTodayWibDate();
  const report = await deps.repo.getTodayReport(user.id, today);
  const creds = getUserGitHubCredentials(deps.config, user);
  const gemini = await getGeminiCredentials(deps.config, deps.repo);
  const quota = await deps.repo.getAiQuotaStatus(
    user.id,
    today,
    deps.config.AI_DAILY_LIMIT,
  );

  const statusText = report
    ? formatStatusLabel(report.status)
    : 'Belum ada aktivitas hari ini';

  const lines = [
    '📊 *Status Akun & Laporan*',
    `• Nama: *${user.display_name}* (ID: \`${user.telegram_chat_id}\`)`,
    `• Tanggal (WIB): \`${today}\``,
    `• Status laporan: *${statusText}*`,
    `• Jadwal: *${user.schedule_time} WIB* (${formatScheduleDays(user.schedule_days)})`,
    `• GitHub: ${creds ? `✅ Terhubung (\`${creds.username || 'token aktif'}\`)` : '⚪ Opsional — belum ditautkan (`/github`)'}`,
    `• Repo whitelist: *${user.whitelisted_repos.length} repo*`,
    `• Gemini AI Global: ${gemini ? `✅ Siap (\`${gemini.model}\`)` : '❌ Belum diatur admin'}`,
    `• Sisa kuota AI hari ini: *${quota.remaining}/${quota.limit}* (terpakai ${quota.used})`,
  ];

  if (report?.error) {
    lines.push(`• Error terakhir: \`${report.error}\``);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

/**
 * Menampilkan 7 riwayat laporan terakhir milik user.
 */
export async function handleRiwayatAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const reports = await deps.repo.getRecentReports(user.id, 7);

  if (reports.length === 0) {
    await ctx.reply('🗂️ Belum ada riwayat laporan tersimpan di akunmu.');
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
 * Mengirim tombol pengingat harian (/tes atau menu Buat Laporan).
 */
export async function handleTesAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const today = getTodayWibDate();
  const existing = await deps.repo.getTodayReport(user.id, today);

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
    await deps.repo.resetNonSubmittedReport(user.id, today);
  }

  const sent = await ctx.reply(buildReminderMessage(today), {
    parse_mode: 'Markdown',
    reply_markup: buildReminderKeyboard(),
  });

  await deps.repo.createOrGetTodayReport(user.id, today, sent.message_id);
}

/**
 * Memasuki mode tulis catatan kegiatan harian manual untuk dikembangkan AI.
 */
export async function handleManualNotesPromptAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const today = getTodayWibDate();
  const quota = await deps.repo.getAiQuotaStatus(
    user.id,
    today,
    deps.config.AI_DAILY_LIMIT,
  );

  if (quota.remaining <= 0) {
    await ctx.reply(
      `⚠️ *Kuota AI harian kamu (${quota.used}/${quota.limit}) sudah habis.*\nKuota akan reset otomatis besok pukul 00:00 WIB.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const existing = await deps.repo.getTodayReport(user.id, today);
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
    await deps.repo.resetNonSubmittedReport(user.id, today);
  }

  await deps.repo.createOrGetTodayReport(user.id, today, undefined, 'manual_ai');
  await deps.repo.updateStatus(user.id, today, 'menunggu_catatan', {
    sourceMode: 'manual_ai',
  });

  await ctx.reply(
    [
      '✍️ *Mode Catatan Kegiatan AI*',
      `Sisa kuota AI hari ini: *${quota.remaining}/${quota.limit}*`,
      '',
      'Silakan ketik dan kirim poin-poin kegiatanmu hari ini (contoh: _"rapat koordinasi tim, memperbaiki tampilan form login, dan melakukan pengujian fitur ekspor data"_).',
      '',
      'AI akan mengembangkannya menjadi 3 kolom format baku Monev (≥ 100 karakter).',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

/**
 * Menampilkan status akun GitHub milik user dan cara menghubungkan.
 */
export async function handleGitHubStatusAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const creds = getUserGitHubCredentials(deps.config, user);
  if (creds) {
    try {
      const info = await validateGitHubToken(creds.token);
      await ctx.reply(
        [
          '🐙 *Status Akun GitHub*',
          '• Status: ✅ *Terhubung*',
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
      '🐙 *Akun GitHub belum ditautkan (Opsional)*',
      '',
      'Jika ingin menarik commit otomatis:',
      '1. *Login via Browser (OAuth Device Flow — bisa pakai akun Google GitHub):*',
      '   Kirim `/github login`',
      '2. *Pakai Fine-grained PAT (Read-only Contents & Metadata):*',
      '   • Buat token di: https://github.com/settings/personal-access-tokens/new',
      '   • Lalu kirim: `/github token <PAT_KAMU>`',
      '',
      '💡 *Tidak punya / tidak pakai GitHub?* Kamu tetap bisa klik *✍️ Catatan AI* untuk membuat laporan dari poin kegiatan.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

/**
 * Menampilkan keyboard interaktif pemilih repository GitHub milik user.
 */
export async function handleRepoListAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const creds = getUserGitHubCredentials(deps.config, user);
  if (!creds) {
    await ctx.reply(
      '❌ Akun GitHub belum terhubung. Kirim `/github` terlebih dahulu (atau pakai *✍️ Catatan AI* tanpa GitHub).',
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

    setCachedRepos(user.telegram_chat_id, accessible);
    const { keyboard, totalPages, currentPage } = buildRepoSelectionKeyboard(
      accessible,
      user.whitelisted_repos,
      0,
    );

    await ctx.reply(
      `📚 *Pilih Repository Whitelist* (Halaman ${currentPage + 1}/${totalPages})\nAktif saat ini: *${user.whitelisted_repos.length} repo*\n\nKlik tombol untuk mengaktifkan/menonaktifkan:`,
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
 * Menampilkan status Gemini AI Global dan sisa kuota harian user.
 */
export async function handleGeminiStatusAction(
  ctx: Context,
  deps: BotActionDeps,
  user: UserRecord,
): Promise<void> {
  const today = getTodayWibDate();
  const gemini = await getGeminiCredentials(deps.config, deps.repo);
  const quota = await deps.repo.getAiQuotaStatus(
    user.id,
    today,
    deps.config.AI_DAILY_LIMIT,
  );

  await ctx.reply(
    [
      '🧠 *Status Gemini AI & Kuota Harian*',
      `• Layanan AI Global: ${gemini ? `✅ *Aktif* (\`${gemini.model}\`)` : '❌ Belum diatur admin'}`,
      `• Kuota harian kamu: *${quota.remaining}/${quota.limit} tersisa* (terpakai ${quota.used})`,
      '• Reset kuota: Setiap hari pukul *00:00 WIB*',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

/**
 * Menampilkan panduan lengkap penggunaan bot.
 */
export async function handleTutorialAction(
  ctx: Context,
  user: UserRecord,
): Promise<void> {
  await ctx.reply(buildTutorialMessage(user), { parse_mode: 'Markdown' });
}
