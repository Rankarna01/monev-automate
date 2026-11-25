import pino from 'pino';

/**
 * Membuat instance logger terstruktur menggunakan pino.
 */
export function createLogger(level: string = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    base: { service: 'monev-bot' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
