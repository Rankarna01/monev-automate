import type { Bot, Context } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import {
  getGitHubCredentials,
  getWhitelistedRepos,
  toggleWhitelistedRepo,
} from '../github/auth.js';
import { fetchTodayCommits } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import { CALLBACK_ACTIONS } from './messages.js';
import { buildRepoSelectionKeyboard, getCachedRepos } from './repoKeyboard.js';

/**
 * Menonaktifkan tombol inline pada pesan yang sudah diproses agar tidak diklik ganda.
 */
async function disableInlineButtons(ctx: Context, updatedText: string): Promise<void> {
  await ctx.editMessageText(updatedText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [] },
  });
}

/**
 * Mendaftarkan handler callback untuk tombol inline Telegram.
 */
export function registerCallbacks(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): void {
  bot.callbackQuery(CALLBACK_ACTIONS.SUMMARIZE, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Buat Ringkasan diklik');

    const creds = await getGitHubCredentials(config, repo);
    if (!creds) {
      await ctx.answerCallbackQuery({
        text: 'Akun GitHub belum terhubung. Kirim /github dulu.',
        show_alert: true,
      });
      return;
    }

    const whitelisted = await getWhitelistedRepos(config, repo);
    if (whitelisted.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'Belum ada repo whitelist. Pilih lewat /repo dulu.',
        show_alert: true,
      });
      return;
    }

    try {
      await repo.createOrGetTodayReport(today, ctx.callbackQuery.message?.message_id);
      await repo.updateStatus(today, 'mengambil_data');
      await ctx.answerCallbackQuery({ text: 'Mengambil commit GitHub hari ini...' });
      await disableInlineButtons(ctx, '🔄 *Mengambil commit GitHub hari ini...*');

      const result = await fetchTodayCommits({
        token: creds.token,
        username: creds.username,
        repos: whitelisted,
        date: today,
      });

      if (result.commits.length === 0) {
        await repo.updateStatus(today, 'dilewati');
        await ctx.reply(
          `ℹ️ *Tidak ada commit hari ini (\`${today}\`)* pada repo whitelist.\nLaporan tidak dibuat.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      await repo.saveCommits(today, JSON.stringify(result.commits));

      const summaryLines = Object.entries(result.perRepoCount).map(
        ([repoName, count]) => `• \`${repoName}\`: *${count} commit*`,
      );
      const previewCommits = result.commits
        .slice(0, 8)
        .map((c) => `• \`${c.sha}\` (${c.repo}): ${c.message.split('\n')[0]}`);

      await ctx.reply(
        [
          `✅ *Ditemukan ${result.commits.length} commit hari ini (\`${today}\`)*`,
          '',
          ...summaryLines,
          '',
          '*Ringkasan commit:*',
          ...previewCommits,
          '',
          '_(Ringkasan AI Gemini & tombol Setujui/Edit akan dihubungkan pada Fase 5.)_',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, today }, 'Gagal mengambil commit GitHub');
      try {
        await repo.updateStatus(today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika state belum tercipta
      }
      await ctx.reply(`❌ Gagal mengambil commit GitHub: ${msg}`);
    }
  });

  bot.callbackQuery(CALLBACK_ACTIONS.SKIP, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Lewati diklik');

    try {
      await repo.createOrGetTodayReport(today, ctx.callbackQuery.message?.message_id);
      await repo.updateStatus(today, 'dilewati');
      await ctx.answerCallbackQuery({ text: 'Laporan hari ini dilewati.' });
      await disableInlineButtons(ctx, '⏭️ *Laporan hari ini dilewati.*');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ err: msg, today }, 'Gagal transisi status saat Lewati');
      await ctx.answerCallbackQuery({
        text: 'Aksi tidak valid untuk status laporan saat ini.',
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(CALLBACK_ACTIONS.SNOOZE_30M, async (ctx) => {
    logger.info({ chatId: ctx.chat?.id }, 'Tombol Ingatkan 30 menit diklik');
    getScheduler().scheduleSnooze(30);
    await ctx.answerCallbackQuery({ text: 'Oke, diingatkan 30 menit lagi.' });
    await disableInlineButtons(
      ctx,
      '⏰ *Pengingat ditunda 30 menit.*\nBot akan mengirim pengingat ulang secara otomatis.',
    );
  });

  // Callback toggle repo whitelist dari /repo
  bot.callbackQuery(/^repo_tg:(\d+):(\d+)$/, async (ctx) => {
    const idx = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const cached = getCachedRepos();
    const target = cached[idx];

    if (!target) {
      await ctx.answerCallbackQuery({
        text: 'Daftar repo kedaluwarsa. Jalankan /repo lagi.',
        show_alert: true,
      });
      return;
    }

    const { repos: whitelisted, added } = await toggleWhitelistedRepo(
      config,
      repo,
      target.fullName,
    );

    const { keyboard, totalPages, currentPage } = buildRepoSelectionKeyboard(
      cached,
      whitelisted,
      page,
    );

    await ctx.answerCallbackQuery({
      text: added
        ? `✅ ${target.fullName} ditambahkan`
        : `⬜ ${target.fullName} dihapus`,
    });

    await ctx.editMessageText(
      `📚 *Pilih Repository Whitelist* (Halaman ${currentPage + 1}/${totalPages})\nAktif saat ini: *${whitelisted.length} repo*\n\nKlik tombol untuk mengaktifkan/menonaktifkan:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      },
    );
  });

  // Callback pagination /repo
  bot.callbackQuery(/^repo_page:(\d+)$/, async (ctx) => {
    const page = Number(ctx.match[1]);
    const cached = getCachedRepos();
    if (cached.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'Daftar repo kedaluwarsa. Jalankan /repo lagi.',
        show_alert: true,
      });
      return;
    }

    const whitelisted = await getWhitelistedRepos(config, repo);
    const { keyboard, totalPages, currentPage } = buildRepoSelectionKeyboard(
      cached,
      whitelisted,
      page,
    );

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📚 *Pilih Repository Whitelist* (Halaman ${currentPage + 1}/${totalPages})\nAktif saat ini: *${whitelisted.length} repo*\n\nKlik tombol untuk mengaktifkan/menonaktifkan:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      },
    );
  });

  bot.callbackQuery('repo_done', async (ctx) => {
    const whitelisted = await getWhitelistedRepos(config, repo);
    await ctx.answerCallbackQuery({ text: 'Daftar repo disimpan!' });
    const listText =
      whitelisted.length > 0
        ? whitelisted.map((r) => `• \`${r}\``).join('\n')
        : '_Belum ada repo dipilih_';

    await disableInlineButtons(
      ctx,
      `✅ *Whitelist repo tersimpan (${whitelisted.length}):*\n${listText}`,
    );
  });
}
