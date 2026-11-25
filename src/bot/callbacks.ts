import type { Bot, Context } from 'grammy';
import type { ReportRepo } from '../db/repo.js';
import type { SchedulerService } from '../scheduler/cron.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import { CALLBACK_ACTIONS } from './messages.js';

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
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): void {
  bot.callbackQuery(CALLBACK_ACTIONS.SUMMARIZE, async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat?.id, today }, 'Tombol Buat Ringkasan diklik');

    try {
      await repo.createOrGetTodayReport(today, ctx.callbackQuery.message?.message_id);
      await repo.updateStatus(today, 'mengambil_data');
      await ctx.answerCallbackQuery({ text: 'Memproses ringkasan...' });
      await disableInlineButtons(
        ctx,
        '📥 *Permintaan ringkasan diterima.*\n\n_(Integrasi GitHub & Gemini akan dihubungkan pada Fase 4 & 5.)_',
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ err: msg, today }, 'Gagal transisi status saat Buat Ringkasan');
      await ctx.answerCallbackQuery({
        text: 'Aksi tidak valid untuk status laporan saat ini.',
        show_alert: true,
      });
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
}
