import { createBot } from './bot/bot.js';
import { loadConfig } from './config.js';
import { initDatabase } from './db/db.js';
import { createReportRepo } from './db/repo.js';
import { createScheduler, type SchedulerService } from './scheduler/cron.js';
import { createLogger } from './utils/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const db = await initDatabase(config, logger);
  const repo = createReportRepo(db.client);

  let scheduler: SchedulerService;
  const bot = createBot(config, logger, repo, () => scheduler);
  scheduler = createScheduler(bot, config, logger, repo);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Mematikan bot dengan aman...');
    scheduler.stop();
    await bot.stop();
    await db.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await scheduler.start();

  logger.info(
    {
      tz: config.TZ,
      scheduleTime: config.SCHEDULE_TIME,
      aiDailyLimit: config.AI_DAILY_LIMIT,
    },
    'Menjalankan bot Telegram multi-user (long polling)...',
  );

  await bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'Bot Telegram berhasil terhubung');
    },
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FATAL] Gagal menjalankan bot:\n${message}`);
  process.exit(1);
});
