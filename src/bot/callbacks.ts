import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { getGeminiCredentials } from '../ai/config.js';
import {
  summarizeCommitsWithGemini,
  summarizeManualNotesWithGemini,
} from '../ai/summarize.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import {
  getUserGitHubCredentials,
  toggleUserWhitelistedRepo,
} from '../github/auth.js';
import { fetchTodayCommits, type CommitSummaryItem } from '../github/commits.js';
import type { SchedulerService } from '../scheduler/cron.js';
import { formatScheduleDays } from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  decodeMediaRef,
  handleGeminiStatusAction,
  handleGitHubStatusAction,
  handleManualNotesPromptAction,
  handleMediaModePromptAction,
  handleRepoListAction,
  handleRiwayatAction,
  handleStatusAction,
  handleTesAction,
  handleTutorialAction,
  processMediaToDraft,
  resolveCurrentUser,
  type BotActionDeps,
} from './actions.js';
import {
  buildDraftKeyboard,
  buildDraftMessage,
  buildEditInstructionMessage,
  buildScheduleKeyboard,
  CALLBACK_ACTIONS,
  DRAFT_ACTIONS,
  MENU_ACTIONS,
} from './messages.js';
import { buildRepoSelectionKeyboard, getCachedRepos } from './repoKeyboard.js';

/**
 * Menjawab callback query dengan aman (tidak menggagalkan proses jika query kedaluwarsa >10 detik).
 */
async function safeAnswerCallback(
  ctx: Context,
  options?: Parameters<Context['answerCallbackQuery']>[0],
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(options);
  } catch {
    // Abaikan jika callback query sudah terlalu lama (query is too old)
  }
}

/**
 * Menonaktifkan tombol inline pada pesan yang sudah diproses agar tidak diklik ganda.
 */
async function disableInlineButtons(ctx: Context, updatedText: string): Promise<void> {
  try {
    await ctx.editMessageText(updatedText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] },
    });
  } catch {
    // Abaikan jika pesan sudah teredit sebelumnya
  }
}

/**
 * Mendaftarkan handler callback untuk tombol inline Telegram (multi-user).
 */
export function registerCallbacks(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): void {
  const deps: BotActionDeps = { config, logger, repo, getScheduler };

  // === Menu Cepat ===
  bot.callbackQuery(MENU_ACTIONS.STATUS, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleStatusAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.TES, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleTesAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.MANUAL_AI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleManualNotesPromptAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.PHOTO_AI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleMediaModePromptAction(ctx, deps, user, 'photo_ai');
  });

  bot.callbackQuery(MENU_ACTIONS.VOICE_AI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleMediaModePromptAction(ctx, deps, user, 'voice_ai');
  });

  bot.callbackQuery(MENU_ACTIONS.GITHUB, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleGitHubStatusAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.REPO, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleRepoListAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.GEMINI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleGeminiStatusAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.RIWAYAT, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleRiwayatAction(ctx, deps, user);
  });

  bot.callbackQuery(MENU_ACTIONS.TUTORIAL, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (user) await handleTutorialAction(ctx, user);
  });

  bot.callbackQuery(MENU_ACTIONS.SCHEDULE, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (!user) return;

    await ctx.reply(
      [
        '🕒 *Pengaturan Jadwal Saat Ini*',
        `• Jam: *${user.schedule_time} WIB*`,
        `• Hari aktif: *${formatScheduleDays(user.schedule_days)}*`,
        '',
        'Pilih jam notifikasi langsung (14:00–17:00 WIB) di bawah ini, atau ubah hari dengan `/hari senin-jumat`:',
      ].join('\n'),
      {
        parse_mode: 'Markdown',
        reply_markup: buildScheduleKeyboard(user.schedule_time),
      },
    );
  });

  bot.callbackQuery(/^set_jam:(\d{2}:\d{2})$/, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const chosenTime = ctx.match[1];
    try {
      const updated = await repo.updateUserSchedule(user.id, { time: chosenTime });
      await ctx.answerCallbackQuery({
        text: `✅ Jam notifikasi diubah ke ${updated.schedule_time} WIB`,
      });
      await ctx.editMessageText(
        [
          '🕒 *Pengaturan Jadwal Saat Ini*',
          `• Jam: *${updated.schedule_time} WIB*`,
          `• Hari aktif: *${formatScheduleDays(updated.schedule_days)}*`,
          '',
          'Pilih jam notifikasi langsung (14:00–17:00 WIB) di bawah ini, atau ubah hari dengan `/hari senin-jumat`:',
        ].join('\n'),
        {
          parse_mode: 'Markdown',
          reply_markup: buildScheduleKeyboard(updated.schedule_time),
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.answerCallbackQuery({ text: `❌ ${msg}`, show_alert: true });
    }
  });

  // === Alur Pengingat Harian ===
  bot.callbackQuery(CALLBACK_ACTIONS.MANUAL_AI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (!user) return;
    await disableInlineButtons(ctx, '✍️ *Mode Catatan Teks AI dipilih.*');
    await handleManualNotesPromptAction(ctx, deps, user);
  });

  bot.callbackQuery(CALLBACK_ACTIONS.PHOTO_AI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (!user) return;
    await disableInlineButtons(ctx, '📷 *Mode Laporan dari Foto dipilih.*');
    await handleMediaModePromptAction(ctx, deps, user, 'photo_ai');
  });

  bot.callbackQuery(CALLBACK_ACTIONS.VOICE_AI, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    await ctx.answerCallbackQuery();
    if (!user) return;
    await disableInlineButtons(ctx, '🎤 *Mode Laporan dari Voice Note dipilih.*');
    await handleMediaModePromptAction(ctx, deps, user, 'voice_ai');
  });

  bot.callbackQuery(CALLBACK_ACTIONS.SUMMARIZE, async (ctx) => {
    await safeAnswerCallback(ctx, {
      text: 'Menarik commit & membuat ringkasan Gemini...',
    });

    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const today = getTodayWibDate();
    logger.info({ userId: user.id, today }, 'Tombol Buat Ringkasan GitHub diklik');

    const creds = getUserGitHubCredentials(config, user);
    if (!creds) {
      await ctx.reply('❌ GitHub belum ditautkan. Kirim `/github` atau pilih *✍️ Catatan Teks*.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (user.whitelisted_repos.length === 0) {
      await ctx.reply('❌ Belum ada repo whitelist. Pilih lewat `/repo` dulu.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const gemini = await getGeminiCredentials(config, repo);
    if (!gemini) {
      await ctx.reply('❌ Layanan Gemini AI global belum diatur admin.');
      return;
    }

    const existing = await repo.getTodayReport(user.id, today);
    if (existing?.status === 'mengambil_data') {
      return;
    }

    try {
      const quota = await repo.consumeAiQuota(
        user.id,
        today,
        config.AI_DAILY_LIMIT,
      );

      await repo.createOrGetTodayReport(
        user.id,
        today,
        ctx.callbackQuery.message?.message_id,
        'github',
      );
      await repo.updateStatus(user.id, today, 'mengambil_data', {
        sourceMode: 'github',
      });
      await disableInlineButtons(
        ctx,
        '🔄 *Sedang mengambil commit GitHub & merangkum dengan Gemini...*',
      );

      const result = await fetchTodayCommits({
        token: creds.token,
        username: creds.username,
        repos: user.whitelisted_repos,
        date: today,
      });

      if (result.commits.length === 0) {
        await repo.updateStatus(user.id, today, 'dilewati');
        await ctx.reply(
          `ℹ️ *Tidak ada commit hari ini (\`${today}\`)* pada repo whitelist.\nJika ada kegiatan non-coding, kamu bisa klik *✍️ Catatan AI* di menu \`halo\`.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      const commitsJson = JSON.stringify(result.commits);
      await repo.saveCommits(user.id, today, commitsJson);

      const draft = await summarizeCommitsWithGemini({
        apiKey: gemini.apiKey,
        model: gemini.model,
        date: today,
        commits: result.commits,
      });

      const sentDraft = await ctx.reply(buildDraftMessage(today, draft, quota), {
        parse_mode: 'Markdown',
        reply_markup: buildDraftKeyboard(),
      });

      await repo.saveDraft(user.id, today, {
        sourceMode: 'github',
        commitsJson,
        ...draft,
        telegramMessageId: sentDraft.message_id,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: user.id, today }, 'Gagal membuat ringkasan');
      try {
        await repo.updateStatus(user.id, today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika transisi tidak memungkinkan
      }
      await ctx.reply(`❌ Gagal membuat ringkasan: ${msg}`, {
        reply_markup: new InlineKeyboard().text(
          '🔄 Coba Lagi',
          CALLBACK_ACTIONS.SUMMARIZE,
        ),
      });
    }
  });

  bot.callbackQuery(CALLBACK_ACTIONS.SKIP, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    const today = getTodayWibDate();

    try {
      await repo.createOrGetTodayReport(
        user.id,
        today,
        ctx.callbackQuery.message?.message_id,
      );
      await repo.updateStatus(user.id, today, 'dilewati');
      await ctx.answerCallbackQuery({ text: 'Laporan hari ini dilewati.' });
      await disableInlineButtons(ctx, '⏭️ *Laporan hari ini dilewati.*');
    } catch {
      await ctx.answerCallbackQuery({
        text: 'Aksi tidak valid untuk status laporan saat ini.',
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(CALLBACK_ACTIONS.SNOOZE_30M, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    getScheduler().scheduleSnooze(30, user.telegram_chat_id);
    await ctx.answerCallbackQuery({ text: 'Oke, diingatkan 30 menit lagi.' });
    await disableInlineButtons(
      ctx,
      '⏰ *Pengingat ditunda 30 menit.*\nBot akan mengirim pengingat ulang secara otomatis.',
    );
  });

  // === Alur Review Draf Gemini ===
  bot.callbackQuery(DRAFT_ACTIONS.APPROVE, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    const today = getTodayWibDate();

    try {
      await repo.updateStatus(user.id, today, 'mengirim');
      await repo.updateStatus(user.id, today, 'terkirim');
      await ctx.answerCallbackQuery({ text: 'Draf disetujui & disimpan!' });
      await disableInlineButtons(
        ctx,
        '✅ *Draf disetujui & disimpan ke riwayat!*\nSilakan salin 3 kolom di atas ke halaman Monev-mu.',
      );
    } catch {
      await ctx.answerCallbackQuery({
        text: 'Draf tidak dapat disetujui pada status saat ini.',
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(DRAFT_ACTIONS.EDIT, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    const today = getTodayWibDate();

    try {
      const report = await repo.getTodayReport(user.id, today);
      if (!report) {
        await ctx.answerCallbackQuery({
          text: 'Data laporan tidak ditemukan.',
          show_alert: true,
        });
        return;
      }

      await repo.updateStatus(user.id, today, 'menunggu_edit');
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
    } catch {
      await ctx.answerCallbackQuery({
        text: 'Tidak bisa mengedit pada status saat ini.',
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(DRAFT_ACTIONS.REGENERATE, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    const today = getTodayWibDate();

    const gemini = await getGeminiCredentials(config, repo);
    if (!gemini) {
      await ctx.answerCallbackQuery({
        text: 'Layanan Gemini AI global belum diatur admin.',
        show_alert: true,
      });
      return;
    }

    try {
      const report = await repo.getTodayReport(user.id, today);
      if (!report || (!report.commits_json && !report.manual_notes)) {
        await ctx.answerCallbackQuery({
          text: 'Data sumber tidak ditemukan. Mulai ulang dengan /tes.',
          show_alert: true,
        });
        return;
      }

      if (
        (report.source_mode === 'photo_ai' || report.source_mode === 'voice_ai') &&
        report.manual_notes
      ) {
        const mediaRef = decodeMediaRef(report.manual_notes);
        if (!mediaRef) {
          await ctx.answerCallbackQuery({
            text: 'Referensi media tidak ditemukan. Kirim ulang foto/voice.',
            show_alert: true,
          });
          return;
        }
        await ctx.answerCallbackQuery({ text: 'Membuat ulang draf dari media...' });
        await disableInlineButtons(ctx, '🔄 *Membuat ulang draf dari media dengan Gemini...*');
        await processMediaToDraft(ctx, deps, user, report.source_mode, mediaRef);
        return;
      }

      const quota = await repo.consumeAiQuota(
        user.id,
        today,
        config.AI_DAILY_LIMIT,
      );

      await repo.updateStatus(user.id, today, 'mengambil_data');
      await ctx.answerCallbackQuery({ text: 'Membuat ulang draf dengan Gemini...' });
      await disableInlineButtons(ctx, '🔄 *Membuat ulang draf dengan Gemini...*');

      const draft =
        report.source_mode === 'manual_ai' && report.manual_notes
          ? await summarizeManualNotesWithGemini({
              apiKey: gemini.apiKey,
              model: gemini.model,
              date: today,
              manualNotes: report.manual_notes,
            })
          : await summarizeCommitsWithGemini({
              apiKey: gemini.apiKey,
              model: gemini.model,
              date: today,
              commits: JSON.parse(report.commits_json!) as CommitSummaryItem[],
            });

      const sentDraft = await ctx.reply(buildDraftMessage(today, draft, quota), {
        parse_mode: 'Markdown',
        reply_markup: buildDraftKeyboard(),
      });

      await repo.saveDraft(user.id, today, {
        ...draft,
        telegramMessageId: sentDraft.message_id,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ err: msg, userId: user.id, today }, 'Gagal membuat ulang draf');
      try {
        await repo.updateStatus(user.id, today, 'gagal', { error: msg });
      } catch {
        // Abaikan jika transisi gagal
      }
      await ctx.reply(`❌ Gagal membuat ulang draf: ${msg}`);
    }
  });

  bot.callbackQuery(DRAFT_ACTIONS.CANCEL, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;
    const today = getTodayWibDate();

    try {
      await repo.updateStatus(user.id, today, 'dilewati');
      await ctx.answerCallbackQuery({ text: 'Draf dibatalkan.' });
      await disableInlineButtons(ctx, '❌ *Draf laporan hari ini dibatalkan.*');
    } catch {
      await ctx.answerCallbackQuery({
        text: 'Tidak dapat membatalkan pada status saat ini.',
        show_alert: true,
      });
    }
  });

  // === Callback Toggle & Pagination Repo Whitelist ===
  bot.callbackQuery(/^repo_tg:(\d+):(\d+)$/, async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const idx = Number(ctx.match[1]);
    const page = Number(ctx.match[2]);
    const cached = getCachedRepos(user.telegram_chat_id);
    const target = cached[idx];

    if (!target) {
      await ctx.answerCallbackQuery({
        text: 'Daftar repo kedaluwarsa. Jalankan /repo lagi.',
        show_alert: true,
      });
      return;
    }

    const { repos: whitelisted, added } = await toggleUserWhitelistedRepo(
      repo,
      user,
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
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    const page = Number(ctx.match[1]);
    const cached = getCachedRepos(user.telegram_chat_id);
    if (cached.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'Daftar repo kedaluwarsa. Jalankan /repo lagi.',
        show_alert: true,
      });
      return;
    }

    const { keyboard, totalPages, currentPage } = buildRepoSelectionKeyboard(
      cached,
      user.whitelisted_repos,
      page,
    );

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `📚 *Pilih Repository Whitelist* (Halaman ${currentPage + 1}/${totalPages})\nAktif saat ini: *${user.whitelisted_repos.length} repo*\n\nKlik tombol untuk mengaktifkan/menonaktifkan:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      },
    );
  });

  bot.callbackQuery('repo_done', async (ctx) => {
    const user = await resolveCurrentUser(ctx, repo);
    if (!user) return;

    await ctx.answerCallbackQuery({ text: 'Daftar repo disimpan!' });
    const listText =
      user.whitelisted_repos.length > 0
        ? user.whitelisted_repos.map((r) => `• \`${r}\``).join('\n')
        : '_Belum ada repo dipilih_';

    await disableInlineButtons(
      ctx,
      `✅ *Whitelist repo tersimpan (${user.whitelisted_repos.length}):*\n${listText}`,
    );
  });
}
