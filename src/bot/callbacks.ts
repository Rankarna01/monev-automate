import type { Bot, Context } from 'grammy';
import { summarizeCommitsWithGemini } from '../ai/summarize.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import {
  getGitHubCredentials,
  getWhitelistedRepos,
  toggleWhitelistedRepo,
} from '../github/auth.js';
import { fetchTodayCommits, type CommitSummaryItem } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import { formatScheduleDays } from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  handleGitHubStatusAction,
  handleRepoListAction,
  handleRiwayatAction,
  handleStatusAction,
  handleTesAction,
  type BotActionDeps,
} from './actions.js';
import {
  buildDraftKeyboard,
  buildDraftMessage,
  buildEditInstructionMessage,
  CALLBACK_ACTIONS,
  DRAFT_ACTIONS,
  MENU_ACTIONS,
} from './messages.js';
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
  const deps: BotActionDeps = { config, logger, repo, getScheduler };

  // === Menu Cepat dari Sapaan ("halo") ===
  bot.callbackQuery(MENU_ACTIONS.STATUS, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleStatusAction(ctx, deps);
  });

  bot.callbackQuery(MENU_ACTIONS.TES, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleTesAction(ctx, deps);
  });

  bot.callbackQuery(MENU_ACTIONS.GITHUB, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleGitHubStatusAction(ctx, deps);
  });

  bot.callbackQuery(MENU_ACTIONS.REPO, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRepoListAction(ctx, deps);
  });

  bot.callbackQuery(MENU_ACTIONS.RIWAYAT, async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRiwayatAction(ctx, deps);
  });

  bot.callbackQuery(MENU_ACTIONS.SCHEDULE, async (ctx) => {
    await ctx.answerCallbackQuery();
    const schedule = getScheduler().getCurrentSchedule();
    await ctx.reply(
      [
        '🕒 *Pengaturan Jadwal Saat Ini*',
        `• Jam: *${schedule.time} WIB*`,
        `• Hari aktif: *${formatScheduleDays(schedule.days)}*`,
        '',
        'Ubah via perintah:',
        '• `/jam 14:30`',
        '• `/hari senin-jumat`',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  // === Alur Pengingat Harian ===
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

    if (!config.GEMINI_API_KEY) {
      await ctx.answerCallbackQuery({
        text: 'GEMINI_API_KEY belum diisi di .env.',
        show_alert: true,
      });
      return;
    }

    try {
      await repo.createOrGetTodayReport(today, ctx.callbackQuery.message?.message_id);
      await repo.updateStatus(today, 'mengambil_data');
      await ctx.answerCallbackQuery({ text: 'Menarik commit & membuat ringkasan Gemini...' });
      await disableInlineButtons(
        ctx,
        '🔄 *Sedang mengambil commit GitHub & merangkum dengan Gemini...*',
      );

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

      const commitsJson = JSON.stringify(result.commits);
      await repo.saveCommits(today, commitsJson);

      const draft = await summarizeCommitsWithGemini({
        apiKey: config.GEMINI_API_KEY,
        model: config.GEMINI_MODEL,
        date: today,
        commits: result.commits,
      });

      const sentDraft = await ctx.reply(buildDraftMessage(today, draft), {
        parse_mode: 'Markdown',
        reply_markup: buildDraftKeyboard(),
      });

      await repo.saveDraft(today, {
        commitsJson,
        ...draft,
        telegramMessageId: sentDraft.message_id,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, today }, 'Gagal membuat ringkasan');
      try {
        await repo.updateStatus(today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika transisi tidak memungkinkan
      }
      await ctx.reply(`❌ Gagal membuat ringkasan: ${msg}`);
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

  // === Alur Review Draf Gemini ===
  bot.callbackQuery(DRAFT_ACTIONS.APPROVE, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Setujui & Kirim diklik');

    try {
      await repo.updateStatus(today, 'mengirim');
      await ctx.answerCallbackQuery({ text: 'Draf disetujui!' });
      await disableInlineButtons(
        ctx,
        '✅ *Draf disetujui!*\n\n_(Otomasi pengisian & submit ke Monev via Playwright akan dihubungkan pada Fase 6.)_',
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ err: msg, today }, 'Gagal menyetujui draf');
      await ctx.answerCallbackQuery({
        text: 'Draf tidak dapat disetujui pada status saat ini.',
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(DRAFT_ACTIONS.EDIT, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Edit draf diklik');

    try {
      const report = await repo.getTodayReport(today);
      if (!report) {
        await ctx.answerCallbackQuery({ text: 'Data laporan tidak ditemukan.', show_alert: true });
        return;
      }

      await repo.updateStatus(today, 'menunggu_edit');
      await ctx.answerCallbackQuery({ text: 'Silakan kirim teks revisi.' });
      await disableInlineButtons(ctx, '✏️ *Menunggu revisi teks dari kamu...*');

      await ctx.reply(
        buildEditInstructionMessage({
          aktivitas: report.aktivitas ?? '',
          pembelajaran: report.pembelajaran ?? '',
          kendala: report.kendala ?? '',
        }),
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ err: msg, today }, 'Gagal masuk mode edit');
      await ctx.answerCallbackQuery({
        text: 'Tidak bisa mengedit pada status saat ini.',
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(DRAFT_ACTIONS.REGENERATE, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Buat Ulang draf diklik');

    if (!config.GEMINI_API_KEY) {
      await ctx.answerCallbackQuery({
        text: 'GEMINI_API_KEY belum diisi di .env.',
        show_alert: true,
      });
      return;
    }

    try {
      const report = await repo.getTodayReport(today);
      if (!report || !report.commits_json) {
        await ctx.answerCallbackQuery({
          text: 'Data commit tidak ditemukan. Mulai ulang dengan /tes.',
          show_alert: true,
        });
        return;
      }

      const commits = JSON.parse(report.commits_json) as CommitSummaryItem[];
      await repo.updateStatus(today, 'mengambil_data');
      await ctx.answerCallbackQuery({ text: 'Membuat ulang draf dengan Gemini...' });
      await disableInlineButtons(ctx, '🔄 *Membuat ulang draf dengan Gemini...*');

      const draft = await summarizeCommitsWithGemini({
        apiKey: config.GEMINI_API_KEY,
        model: config.GEMINI_MODEL,
        date: today,
        commits,
      });

      const sentDraft = await ctx.reply(buildDraftMessage(today, draft), {
        parse_mode: 'Markdown',
        reply_markup: buildDraftKeyboard(),
      });

      await repo.saveDraft(today, {
        ...draft,
        telegramMessageId: sentDraft.message_id,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, today }, 'Gagal membuat ulang draf');
      try {
        await repo.updateStatus(today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika transisi gagal
      }
      await ctx.reply(`❌ Gagal membuat ulang draf: ${msg}`);
    }
  });

  bot.callbackQuery(DRAFT_ACTIONS.CANCEL, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Batal draf diklik');

    try {
      await repo.updateStatus(today, 'dilewati');
      await ctx.answerCallbackQuery({ text: 'Draf dibatalkan.' });
      await disableInlineButtons(ctx, '❌ *Draf laporan hari ini dibatalkan.*');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ err: msg, today }, 'Gagal membatalkan draf');
      await ctx.answerCallbackQuery({
        text: 'Tidak dapat membatalkan pada status saat ini.',
        show_alert: true,
      });
    }
  });

  // === Callback Toggle & Pagination Repo Whitelist ===
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
