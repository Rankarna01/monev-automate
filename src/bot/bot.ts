import { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';
import type { SchedulerService } from '../scheduler/cron.js';
import type { Logger } from '../utils/logger.js';
import { registerCallbacks } from './callbacks.js';
import { registerCommands } from './commands.js';

/**
 * Menginisialisasi bot grammY dalam mode multi-user langsung via Telegram.
 */
export function createBot(
  config: AppConfig,
  logger: Logger,
  repo: ReportRepo,
  getScheduler: () => SchedulerService,
): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Hanya memproses chat pribadi (atau update yang memiliki chat_id & pengirim valid)
  bot.use(async (ctx, next) => {
    if (!ctx.chat?.id || !ctx.from || ctx.from.is_bot) {
      return;
    }
    await next();
  });

  registerCommands(bot, config, logger, repo, getScheduler);
  registerCallbacks(bot, config, logger, repo, getScheduler);

  bot.catch((err) => {
    logger.error(
      { err: err.error, updateId: err.ctx.update.update_id },
      'Error pada bot Telegram',
    );
  });

  return bot;
}
