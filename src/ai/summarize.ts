import { GoogleGenAI, Type } from '@google/genai';
import type { CommitSummaryItem } from '../github/commits.js';
import { validateDraft, type ReportDraft } from '../utils/validate.js';
import {
  buildCommitsPromptInput,
  buildManualNotesPromptInput,
  SYSTEM_PROMPT,
} from './prompt.js';

const MAX_VALIDATION_RETRIES = 2;
const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

export interface SummarizeOptions {
  apiKey: string;
  model: string;
  date: string;
  commits: CommitSummaryItem[];
}

export interface SummarizeNotesOptions {
  apiKey: string;
  model: string;
  date: string;
  manualNotes: string;
  commits?: CommitSummaryItem[];
}

/**
 * Membersihkan kemungkinan pembungkus markdown ```json ... ``` pada output teks LLM.
 */
export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function isTransientOrUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND')
  );
}

async function generateWithFallback(
  ai: GoogleGenAI,
  primaryModel: string,
  promptInput: string,
): Promise<string> {
  const modelsToTry = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));
  let lastError: unknown;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: promptInput,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              aktivitas: { type: Type.STRING },
              pembelajaran: { type: Type.STRING },
              kendala: { type: Type.STRING },
            },
            required: ['aktivitas', 'pembelajaran', 'kendala'],
          },
        },
      });
      return response.text ?? '';
    } catch (error) {
      lastError = error;
      if (!isTransientOrUnavailableError(error) || i === modelsToTry.length - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runPromptWithValidation(
  apiKey: string,
  model: string,
  buildPrompt: (retryHint?: string) => string,
): Promise<ReportDraft> {
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY global belum diatur. Hubungi admin atau atur via /gemini key.',
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  let retryHint: string | undefined;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    const promptInput = buildPrompt(retryHint);
    const rawText = await generateWithFallback(ai, model, promptInput);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonString(rawText));
    } catch {
      lastErrors = ['Output Gemini bukan JSON yang valid'];
      retryHint = 'Keluarkan JSON valid murni tanpa teks tambahan.';
      continue;
    }

    const validation = validateDraft(parsedJson);
    if (validation.success) {
      return validation.data;
    }

    lastErrors = validation.errors;
    retryHint = `Percobaan sebelumnya gagal validasi: ${lastErrors.join('; ')}. Perpanjang bagian yang kurang hingga minimal 120 karakter.`;
  }

  throw new Error(
    `Ringkasan Gemini gagal validasi setelah ${MAX_VALIDATION_RETRIES + 1} percobaan: ${lastErrors.join('; ')}`,
  );
}

/**
 * Merangkum daftar commit menjadi 3 field laporan Monev menggunakan Gemini API.
 */
export async function summarizeCommitsWithGemini(
  options: SummarizeOptions,
): Promise<ReportDraft> {
  if (options.commits.length === 0) {
    throw new Error('Tidak ada commit untuk dirangkum.');
  }

  return runPromptWithValidation(options.apiKey, options.model, (retryHint) =>
    buildCommitsPromptInput(options.date, options.commits, retryHint),
  );
}

/**
 * Mengembangkan catatan singkat kegiatan pengguna (tanpa GitHub / hybrid) menjadi 3 field Monev.
 */
export async function summarizeManualNotesWithGemini(
  options: SummarizeNotesOptions,
): Promise<ReportDraft> {
  if (!options.manualNotes.trim()) {
    throw new Error('Catatan kegiatan tidak boleh kosong.');
  }

  return runPromptWithValidation(options.apiKey, options.model, (retryHint) =>
    buildManualNotesPromptInput(
      options.date,
      options.manualNotes,
      options.commits ?? [],
      retryHint,
    ),
  );
}
