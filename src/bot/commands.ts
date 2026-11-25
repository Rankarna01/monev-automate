import type { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import { formatStatusLabel } from '../db/stateMachine.js';
import type { SchedulerService } from '../scheduler/cron.js';
import {
  formatScheduleDays,
  parseScheduleDays,
  parseScheduleTime,
} from '../scheduler/scheduleParser.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  buildReminderKeyboard,
  buildReminderMessage,
  buildStartMessage,
} from './messages.js';

/**
 * Mendaftarkan perintah slash bot Telegram (/start, /status, /jam, /hari, /riwayat, /tes).
 */
export function registerCommands(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): void {
  bot.command('start', async (ctx) => {
    logger.info({ chatId: ctx.chat.id }, 'Perintah /start diterima');
    const schedule = getScheduler().getCurrentSchedule();
    await ctx.reply(
      buildStartMessage(schedule.time, formatScheduleDays(schedule.days)),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('status', async (ctx) => {
    const today = getTodayWibDate();
    logger.info({ chatId: ctx.chat.id, today }, 'Perintah /status diterima');

    const report = await repo.getTodayReport(today);
    const schedule = getScheduler().getCurrentSchedule();
    const statusText = report
      ? formatStatusLabel(report.status)
      : 'Belum ada aktivitas hari ini';

    const lines = [
      '📊 *Status Bot & Laporan*',
      `• Tanggal (WIB): \`${today}\``,
      `• Status laporan: *${statusText}*`,
      `• Jadwal: *${schedule.time} WIB* (${formatScheduleDays(schedule.days)})`,
      `• Mode Dry Run Monev: \`${config.DRY_RUN ? 'aktif' : 'nonaktif'}\``,
    ];

    if (report?.error) {
      lines.push(`• Error terakhir: \`${report.error}\``);
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('jam', async (ctx) => {
    const arg = ctx.match.trim();
    const scheduler = getScheduler();

    if (!arg) {
      const current = scheduler.getCurrentSchedule();
      await ctx.reply(
        `🕒 Jam pengingat saat ini: *${current.time} WIB*\nGunakan \`/jam 14:30\` untuk mengubah.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const parsed = parseScheduleTime(arg);
      const updated = await scheduler.reloadSchedule(parsed.formatted, undefined);
      logger.info({ time: updated.time }, 'Jadwal jam diperbarui via /jam');
      await ctx.reply(
        `✅ Jam pengingat harian diubah menjadi *${updated.time} WIB* (${formatScheduleDays(updated.days)}).`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ ${msg}`);
    }
  });

  bot.command('hari', async (ctx) => {
    const arg = ctx.match.trim();
    const scheduler = getScheduler();

    if (!arg) {
      const current = scheduler.getCurrentSchedule();
      await ctx.reply(
        `📅 Hari aktif saat ini: *${formatScheduleDays(current.days)}*\nContoh ubah: \`/hari senin-jumat\` atau \`/hari senin,rabu,jumat\``,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    try {
      const days = parseScheduleDays(arg);
      const updated = await scheduler.reloadSchedule(undefined, days);
      logger.info({ days: updated.days }, 'Hari aktif diperbarui via /hari');
      await ctx.reply(
        `✅ Hari aktif pengingat diubah menjadi *${formatScheduleDays(updated.days)}* (pukul *${updated.time} WIB*).`,
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await ctx.reply(`❌ ${msg}`);
    }
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
