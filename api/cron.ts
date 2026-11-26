import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBot } from '../src/bot/bot.js';
import { loadConfig } from '../src/config.js';
import { initDatabase } from '../src/db/db.js';
import { createReportRepo } from '../src/db/repo.js';
import { createScheduler } from '../src/scheduler/cron.js';
import { createLogger } from '../src/utils/logger.js';

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const db = await initDatabase(config, logger);
  const repo = createReportRepo(db.client);

  let scheduler: ReturnType<typeof createScheduler>;
  const bot = createBot(config, logger, repo, () => scheduler);
  scheduler = createScheduler(bot, config, logger, repo);

  const sentCount = await scheduler.triggerDailyReminder('cron');

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, triggered: true, sentCount }));
}
