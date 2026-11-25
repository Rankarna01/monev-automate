import { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import type { SchedulerService } from '../scheduler/cron.js';
import type { Logger } from '../utils/logger.js';
import { registerCallbacks } from './callbacks.js';
import { registerCommands } from './commands.js';

/**
 * Menginisialisasi bot grammY dengan guard chat_id pemilik, perintah, dan callback.
 */
export function createBot(
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Guard keamanan: hanya chat_id pemilik yang diizinkan mengakses bot
  bot.use(async (ctx, next) => {
    const incomingChatId = ctx.chat?.id;
    if (incomingChatId !== config.TELEGRAM_CHAT_ID) {
      logger.warn(
        {
          incomingChatId,
          fromId: ctx.from?.id,
          username: ctx.from?.username,
        },
        'Akses ditolak: chat_id tidak cocok dengan pemilik',
      );
      return;
    }

    await next();
  });

  registerCommands(bot, config, logger, repo, getScheduler);
  registerCallbacks(bot, logger, repo, getScheduler);

  bot.catch((err) => {
    logger.error({ err: err.error, updateId: err.ctx.update.update_id }, 'Error pada bot Telegram');
  });

  return bot;
}
