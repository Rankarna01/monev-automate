import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../config.js';
import type { ReportRepo } from '../db/repo.js';

const SETTING_GEMINI_API_KEY = 'gemini_api_key';
const SETTING_GEMINI_MODEL = 'gemini_model';

export interface GeminiCredentials {
  apiKey: string;
  model: string;
}

/**
 * Mengambil GEMINI_API_KEY & GEMINI_MODEL dari Supabase (prioritas) atau fallback ke .env.
 */
export async function getGeminiCredentials(
  config: AppConfig,
  repo: ReportRepo,
): Promise<GeminiCredentials | null> {
  const dbKey = await repo.getSetting(SETTING_GEMINI_API_KEY);
  const dbModel = await repo.getSetting(SETTING_GEMINI_MODEL);

  const apiKey = dbKey || config.GEMINI_API_KEY;
  const model = dbModel || config.GEMINI_MODEL;

  if (!apiKey) {
    return null;
  }

  return { apiKey, model };
}

/**
 * Menyimpan GEMINI_API_KEY secara dinamis ke database.
 */
export async function saveGeminiApiKey(
  repo: ReportRepo,
  apiKey: string,
): Promise<void> {
  await repo.setSetting(SETTING_GEMINI_API_KEY, apiKey.trim());
}

/**
 * Menyimpan model Gemini aktif ke database.
 */
export async function saveGeminiModel(
  repo: ReportRepo,
  model: string,
): Promise<void> {
  await repo.setSetting(SETTING_GEMINI_MODEL, model.trim());
}

/**
 * Menghapus GEMINI_API_KEY dinamis dari database.
 */
export async function clearGeminiApiKey(repo: ReportRepo): Promise<void> {
  await repo.setSetting(SETTING_GEMINI_API_KEY, '');
}

/**
 * Memvalidasi API key Gemini dengan panggilan ringan.
 */
export async function validateGeminiApiKey(
  apiKey: string,
  model: string,
): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  await ai.models.generateContent({
    model,
    contents: 'Balas dengan satu kata: OK',
  });
}
