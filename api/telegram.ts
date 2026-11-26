import type { IncomingMessage, ServerResponse } from 'node:http';
import { webhookCallback } from 'grammy';
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
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'monev-bot', mode: 'webhook' }));
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const db = await initDatabase(config, logger);
  const repo = createReportRepo(db.client);

  let scheduler: ReturnType<typeof createScheduler>;
  const bot = createBot(config, logger, repo, () => scheduler);
  scheduler = createScheduler(bot, config, logger, repo);
  await scheduler.loadOnly?.();

  const handleUpdate = webhookCallback(bot, 'http', {
    timeoutMilliseconds: 55_000,
  });
  await handleUpdate(req, res);
}
