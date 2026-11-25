import type { Bot } from 'grammy';
import cron, { type ScheduledTask } from 'node-cron';
import { buildReminderKeyboard, buildReminderMessage } from '../bot/messages.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import {
  buildCronExpression,
  isScheduledTimePassedToday,
  parseScheduleDays,
  parseScheduleTime,
} from './scheduleParser.js';

const SETTING_SCHEDULE_TIME = 'schedule_time';
const SETTING_SCHEDULE_DAYS = 'schedule_days';
const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // Senin-Jumat

export interface ScheduleState {
  time: string;
  days: number[];
}

export interface SchedulerService {
  start: () => Promise<void>;
  stop: () => void;
  reloadSchedule: (nextTime?: string, nextDays?: number[]) => Promise<ScheduleState>;
  getCurrentSchedule: () => ScheduleState;
  scheduleSnooze: (minutes?: number) => void;
  triggerDailyReminder: (source: 'cron' | 'recovery' | 'snooze') => Promise<void>;
}

/**
 * Membuat layanan scheduler harian berbasis node-cron (zona Asia/Jakarta),
 * lengkap dengan tunda 30 menit, cek kedaluwarsa, dan pemulihan saat bot baru hidup.
 */
export function createScheduler(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
): SchedulerService {
  let currentTime = config.SCHEDULE_TIME;
  let currentDays = [...DEFAULT_DAYS];
  let dailyTask: ScheduledTask | null = null;
  let expiryTask: ScheduledTask | null = null;
  let snoozeTimer: NodeJS.Timeout | null = null;

  async function loadScheduleFromDb(): Promise<void> {
    const savedTime = await repo.getSetting(SETTING_SCHEDULE_TIME);
    if (savedTime) {
      try {
        currentTime = parseScheduleTime(savedTime).formatted;
      } catch {
        logger.warn({ savedTime }, 'schedule_time di DB tidak valid, memakai default');
      }
    }

    const savedDays = await repo.getSetting(SETTING_SCHEDULE_DAYS);
    if (savedDays) {
      try {
        const parsed = JSON.parse(savedDays) as unknown;
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
          currentDays = parsed;
        }
      } catch {
        currentDays = parseScheduleDays(savedDays);
      }
    }
  }

  function registerDailyCron(): void {
    if (dailyTask) {
      dailyTask.stop();
      dailyTask = null;
    }

    const { hour, minute } = parseScheduleTime(currentTime);
    const expr = buildCronExpression(hour, minute, currentDays);

    dailyTask = cron.schedule(
      expr,
      () => {
        void triggerDailyReminder('cron');
      },
      { timezone: 'Asia/Jakarta' },
    );

    logger.info(
      { cron: expr, time: currentTime, days: currentDays, timezone: 'Asia/Jakarta' },
      'Jadwal cron harian aktif',
    );
  }

  async function checkApprovalTimeout(): Promise<void> {
    const today = getTodayWibDate();
    const report = await repo.getTodayReport(today);
    if (!report) return;

    const expirableStatuses = new Set([
      'menunggu_trigger',
      'draf_siap',
      'menunggu_edit',
    ]);
    if (!expirableStatuses.has(report.status)) return;

    const timeoutMs = config.APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000;
    const elapsedMs = Date.now() - new Date(report.created_at).getTime();

    if (elapsedMs < timeoutMs) return;

    await repo.updateStatus(today, 'kedaluwarsa');
    logger.info({ today, previousStatus: report.status }, 'Laporan hari ini kedaluwarsa');

    if (report.telegram_message_id) {
      try {
        await bot.api.editMessageReplyMarkup(
          config.TELEGRAM_CHAT_ID,
          report.telegram_message_id,
          { reply_markup: { inline_keyboard: [] } },
        );
      } catch {
        // Abaikan jika pesan lama sudah tidak bisa diedit
      }
    }

    await bot.api.sendMessage(
      config.TELEGRAM_CHAT_ID,
      `⌛ *Laporan tanggal \`${today}\` kedaluwarsa* karena melewati batas waktu ${config.APPROVAL_TIMEOUT_HOURS} jam tanpa persetujuan.`,
      { parse_mode: 'Markdown' },
    );
  }

  async function triggerDailyReminder(
    source: 'cron' | 'recovery' | 'snooze',
  ): Promise<void> {
    const today = getTodayWibDate();
    const existing = await repo.getTodayReport(today);

    if (source === 'cron' || source === 'recovery') {
      if (existing) {
        logger.debug({ today, source, status: existing.status }, 'Notifikasi harian dilewati (sudah ada record hari ini)');
        return;
      }
    } else if (source === 'snooze') {
      if (existing && existing.status !== 'menunggu_trigger') {
        logger.debug({ today, status: existing.status }, 'Pengingat tunda dibatalkan karena status sudah berubah');
        return;
      }
    }

    const prefix =
      source === 'recovery'
        ? '🔔 *(Pengingat tertunda karena bot sempat offline)*\n\n'
        : source === 'snooze'
          ? '⏰ *(Pengingat ulang 30 menit)*\n\n'
          : '';

    const sent = await bot.api.sendMessage(
      config.TELEGRAM_CHAT_ID,
      `${prefix}${buildReminderMessage(today)}`,
      {
        parse_mode: 'Markdown',
        reply_markup: buildReminderKeyboard(),
      },
    );

    await repo.createOrGetTodayReport(today, sent.message_id);
    logger.info({ today, source, messageId: sent.message_id }, 'Notifikasi pengingat harian terkirim');
  }

  function scheduleSnooze(minutes: number = 30): void {
    if (snoozeTimer) {
      clearTimeout(snoozeTimer);
      snoozeTimer = null;
    }

    const delayMs = minutes * 60 * 1000;
    snoozeTimer = setTimeout(() => {
      snoozeTimer = null;
      void triggerDailyReminder('snooze');
    }, delayMs);

    logger.info({ minutes }, 'Timer tunda pengingat dijadwalkan');
  }

  async function reloadSchedule(
    nextTime?: string,
    nextDays?: number[],
  ): Promise<ScheduleState> {
    if (nextTime !== undefined) {
      const parsed = parseScheduleTime(nextTime);
      currentTime = parsed.formatted;
      await repo.setSetting(SETTING_SCHEDULE_TIME, currentTime);
    }

    if (nextDays !== undefined) {
      currentDays = [...nextDays];
      await repo.setSetting(SETTING_SCHEDULE_DAYS, JSON.stringify(currentDays));
    }

    registerDailyCron();
    return { time: currentTime, days: [...currentDays] };
  }

  async function start(): Promise<void> {
    await loadScheduleFromDb();
    registerDailyCron();

    expiryTask = cron.schedule(
      '*/10 * * * *',
      () => {
        void checkApprovalTimeout();
      },
      { timezone: 'Asia/Jakarta' },
    );

    // Cek apakah jadwal hari ini terlewat saat bot offline
    const { hour, minute } = parseScheduleTime(currentTime);
    if (isScheduledTimePassedToday(hour, minute, currentDays)) {
      await triggerDailyReminder('recovery');
    }
  }

  function stop(): void {
    if (dailyTask) {
      dailyTask.stop();
      dailyTask = null;
    }
    if (expiryTask) {
      expiryTask.stop();
      expiryTask = null;
    }
    if (snoozeTimer) {
      clearTimeout(snoozeTimer);
      snoozeTimer = null;
    }
  }

  return {
    start,
    stop,
    reloadSchedule,
    getCurrentSchedule: () => ({ time: currentTime, days: [...currentDays] }),
    scheduleSnooze,
    triggerDailyReminder,
  };
}
