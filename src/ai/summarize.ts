import { GoogleGenAI, Type } from '@google/genai';
import type { CommitSummaryItem } from '../github/commits.js';
import { validateDraft, type ReportDraft } from '../utils/validate.js';
import { buildCommitsPromptInput, SYSTEM_PROMPT } from './prompt.js';

const MAX_RETRIES = 2;

export interface SummarizeOptions {
  apiKey: string;
  model: string;
  date: string;
  commits: CommitSummaryItem[];
}

/**
 * Membersihkan kemungkinan pembungkus markdown ```json ... ``` pada output teks LLM.
 */
export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Merangkum daftar commit menjadi 3 field laporan Monev menggunakan Gemini API,
 * lengkap dengan validasi zod (>= 100 karakter) dan retry otomatis maksimal 2 kali.
 */
export async function summarizeCommitsWithGemini(
  options: SummarizeOptions,
): Promise<ReportDraft> {
  if (!options.apiKey) {
    throw new Error(
      'GEMINI_API_KEY belum diisi di file .env. Isi terlebih dahulu untuk membuat ringkasan AI.',
    );
  }

  if (options.commits.length === 0) {
    throw new Error('Tidak ada commit untuk dirangkum.');
  }

  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  let retryHint: string | undefined;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const promptInput = buildCommitsPromptInput(
      options.date,
      options.commits,
      retryHint,
    );

    const response = await ai.models.generateContent({
      model: options.model,
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

    const rawText = response.text ?? '';

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
    `Ringkasan Gemini gagal validasi setelah ${MAX_RETRIES + 1} percobaan: ${lastErrors.join('; ')}`,
  );
}
