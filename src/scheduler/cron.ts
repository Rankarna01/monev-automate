import type { Bot } from 'grammy';
import cron, { type ScheduledTask } from 'node-cron';
import { buildReminderKeyboard, buildReminderMessage } from '../bot/messages.js';
import type { AppConfig } from '../config.js';
import type { ReportRepo, UserRecord } from '../db/repo.js';
import type { Logger } from '../utils/logger.js';
import { getTodayWibDate } from '../utils/time.js';
import { buildCronExpression, parseScheduleTime } from './scheduleParser.js';

export interface SchedulerService {
  start: () => Promise<void>;
  loadOnly: () => Promise<void>;
  stop: () => void;
  scheduleSnooze: (minutes?: number, chatId?: number) => void;
  triggerDailyReminder: (source: 'cron' | 'snooze', targetChatId?: number) => Promise<number>;
}

/**
 * Membuat layanan scheduler multi-user berbasis node-cron (zona Asia/Jakarta).
 */
export function createScheduler(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
): SchedulerService {
  let dailyTask: ScheduledTask | null = null;
  const snoozeTimers = new Map<number, NodeJS.Timeout>();

  async function sendReminderToUser(
    user: UserRecord,
    today: string,
    source: 'cron' | 'snooze',
  ): Promise<boolean> {
    const existing = await repo.getTodayReport(user.id, today);

    if (source === 'cron' && existing) {
      return false;
    }
    if (source === 'snooze' && existing && existing.status !== 'menunggu_trigger') {
      return false;
    }

    const prefix = source === 'snooze' ? '⏰ *(Pengingat ulang 30 menit)*\n\n' : '';
    const sent = await bot.api.sendMessage(
      user.telegram_chat_id,
      `${prefix}${buildReminderMessage(today)}`,
      {
        parse_mode: 'Markdown',
        reply_markup: buildReminderKeyboard(),
      },
    );

    await repo.createOrGetTodayReport(user.id, today, sent.message_id);
    return true;
  }

  async function triggerDailyReminder(
    source: 'cron' | 'snooze',
    targetChatId?: number,
  ): Promise<number> {
    const today = getTodayWibDate();
    const wibDate = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }),
    );
    const todayDow = wibDate.getDay();

    if (targetChatId !== undefined) {
      const user = await repo.getUserByChatId(targetChatId);
      if (!user) return 0;
      const sent = await sendReminderToUser(user, today, source);
      return sent ? 1 : 0;
    }

    const users = await repo.getAllUsers();
    let sentCount = 0;

    for (const user of users) {
      if (!user.schedule_days.includes(todayDow)) {
        continue;
      }
      try {
        const sent = await sendReminderToUser(user, today, source);
        if (sent) sentCount++;
      } catch (error) {
        logger.warn(
          { err: error instanceof Error ? error.message : String(error), userId: user.id },
          'Gagal mengirim pengingat harian ke user',
        );
      }
    }

    logger.info({ today, sentCount }, 'Pengingat harian multi-user selesai dikirim');
    return sentCount;
  }

  function scheduleSnooze(
    minutes: number = 30,
    chatId: number = config.TELEGRAM_CHAT_ID,
  ): void {
    const existing = snoozeTimers.get(chatId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      snoozeTimers.delete(chatId);
      void triggerDailyReminder('snooze', chatId);
    }, minutes * 60 * 1000);

    snoozeTimers.set(chatId, timer);
  }

  async function start(): Promise<void> {
    const { hour, minute } = parseScheduleTime(config.SCHEDULE_TIME);
    const expr = buildCronExpression(hour, minute, [0, 1, 2, 3, 4, 5, 6]);

    dailyTask = cron.schedule(
      expr,
      () => {
        void triggerDailyReminder('cron');
      },
      { timezone: 'Asia/Jakarta' },
    );

    logger.info({ cron: expr, timezone: 'Asia/Jakarta' }, 'Scheduler multi-user aktif');
  }

  function stop(): void {
    if (dailyTask) {
      dailyTask.stop();
      dailyTask = null;
    }
    for (const timer of snoozeTimers.values()) {
      clearTimeout(timer);
    }
    snoozeTimers.clear();
  }

  return {
    start,
    loadOnly: async () => {},
    stop,
    scheduleSnooze,
    triggerDailyReminder,
  };
}
