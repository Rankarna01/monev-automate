import { z } from 'zod';

export const MIN_FIELD_LENGTH = 100;

export const draftSchema = z.object({
  aktivitas: z
    .string()
    .trim()
    .min(
      MIN_FIELD_LENGTH,
      `Uraian aktivitas minimal ${MIN_FIELD_LENGTH} karakter`,
    ),
  pembelajaran: z
    .string()
    .trim()
    .min(
      MIN_FIELD_LENGTH,
      `Pembelajaran minimal ${MIN_FIELD_LENGTH} karakter`,
    ),
  kendala: z
    .string()
    .trim()
    .min(MIN_FIELD_LENGTH, `Kendala minimal ${MIN_FIELD_LENGTH} karakter`),
});

export type ReportDraft = z.infer<typeof draftSchema>;

export type DraftValidationResult =
  | { success: true; data: ReportDraft }
  | { success: false; errors: string[] };

/**
 * Memvalidasi draf laporan menggunakan zod dan memastikan tiap field >= 100 karakter.
 */
export function validateDraft(input: unknown): DraftValidationResult {
  const parsed = draftSchema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  const obj =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)
      : {};

  const errors = parsed.error.issues.map((issue) => {
    const field = String(issue.path[0] ?? 'field');
    const rawVal = typeof obj[field] === 'string' ? obj[field].trim() : '';
    if (rawVal.length > 0 && rawVal.length < MIN_FIELD_LENGTH) {
      return `${issue.message} (saat ini ${rawVal.length} karakter)`;
    }
    return issue.message;
  });

  return { success: false, errors };
}

/**
 * Mem-parsing teks revisi dari pengguna (mendukung edit sebagian atau seluruh field).
 * Format yang dikenali:
 * Aktivitas: ...
 * Pembelajaran: ...
 * Kendala: ...
 */
export function parseDraftEditText(
  text: string,
  existing: ReportDraft,
): { parsed: ReportDraft; matchedAnyHeader: boolean } {
  const regex = /(?:^|\n)\s*(aktivitas|pembelajaran|kendala)\s*:\s*/gi;
  const matches = Array.from(text.matchAll(regex));

  if (matches.length === 0) {
    return { parsed: existing, matchedAnyHeader: false };
  }

  const updated: ReportDraft = { ...existing };

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[1].toLowerCase() as keyof ReportDraft;
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd =
      i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const value = text.slice(valueStart, valueEnd).trim();
    if (value) {
      updated[key] = value;
    }
  }

  return { parsed: updated, matchedAnyHeader: true };
}
