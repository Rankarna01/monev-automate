import type { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import { formatStatusLabel } from '../db/stateMachine.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  buildReminderKeyboard,
  buildReminderMessage,
  buildStartMessage,
} from './messages.js';

/**
 * Mendaftarkan perintah slash bot Telegram (/start, /status, /riwayat, /tes).
 */
export function registerCommands(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
): void {
  bot.command('start', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /start diterima');
    await ctx.reply(buildStartMessage(config.SCHEDULE_TIME), {
      parse_mode: 'Markdown',
    });
  });

  bot.command('status', async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat.id, today }, 'Perintah /status diterima');

    const report = await repo.getTodayReport(today);
    const statusText = report
      ? formatStatusLabel(report.status)
      : 'Belum ada aktivitas hari ini';

    const lines = [
      '📊 *Status Bot & Laporan*',
      `• Tanggal (WIB): \`${today}\``,
      `• Status laporan: *${statusText}*`,
      `• Mode Dry Run Monev: \`${config.DRY_RUN ? 'aktif' : 'nonaktif'}\``,
    ];

    if (report?.error) {
      lines.push(`• Error terakhir: \`${report.error}\``);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('riwayat', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /riwayat diterima');
    const reports = await repo.getRecentReports(7);

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
  });

  bot.command('tes', async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat.id, today }, 'Perintah /tes diterima');

    const existing = await repo.getTodayReport(today);
    if (
      existing &&
      (existing.status === 'terkirim' ||
        existing.status === 'dilewati' ||
        existing.status === 'kedaluwarsa')
    ) {
      await ctx.reply(
        `ℹ️ Laporan tanggal \`${today}\` sudah berstatus *${formatStatusLabel(existing.status)}*.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const sent = await ctx.reply(buildReminderMessage(today), {
      parse_mode: 'Markdown',
      reply_markup: buildReminderKeyboard(),
    });

    await repo.createOrGetTodayReport(today, sent.message_id);
  });
}
