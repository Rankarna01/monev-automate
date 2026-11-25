import 'dotenv/config';
import { z } from 'zod';

const booleanStringSchema = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((val) => val === 'true' || val === '1');

const envSchema = z.object({
  // Telegram (Wajib di Fase 1)
  TELEGRAM_BOT_TOKEN: z
    .string()
    .trim()
    .min(1, 'TELEGRAM_BOT_TOKEN wajib diisi di file .env'),
  TELEGRAM_CHAT_ID: z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'TELEGRAM_CHAT_ID harus berupa angka (contoh: 123456789)')
    .transform((val) => Number(val)),

  // GitHub (Fase 4)
  GITHUB_TOKEN: z.string().trim().optional().default(''),
  GITHUB_USERNAME: z.string().trim().optional().default(''),
  GITHUB_REPOS: z
    .string()
    .trim()
    .optional()
    .default('')
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
        : [],
    ),

  // Gemini (Fase 5)
  GEMINI_API_KEY: z.string().trim().optional().default(''),
  GEMINI_MODEL: z.string().trim().optional().default('gemini-2.5-flash'),

  // Monev (Fase 6)
  MONEV_URL: z.string().trim().optional().default(''),
  BROWSER_PROFILE_DIR: z
    .string()
    .trim()
    .optional()
    .default('./data/browser-profile'),
  DRY_RUN: booleanStringSchema,

  // Umum
  TZ: z.string().trim().optional().default('Asia/Jakarta'),
  SCHEDULE_TIME: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, 'SCHEDULE_TIME harus berformat HH:MM (contoh: 14:00)')
    .optional()
    .default('14:00'),
  APPROVAL_TIMEOUT_HOURS: z.coerce.number().int().positive().optional().default(3),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional()
    .default('info'),

  // MySQL (Fase 2)
  MYSQL_HOST: z.string().trim().optional().default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().positive().optional().default(3306),
  MYSQL_USER: z.string().trim().optional().default('root'),
  MYSQL_PASSWORD: z.string().optional().default(''),
  MYSQL_DATABASE: z.string().trim().optional().default('monev_bot'),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Membaca dan memvalidasi variabel lingkungan dari .env menggunakan zod.
 * Melempar error yang jelas jika konfigurasi wajib belum diisi.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Konfigurasi .env tidak valid:\n${issues}`);
  }

  return parsed.data;
}
