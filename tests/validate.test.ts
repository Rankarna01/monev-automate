import { describe, expect, it } from 'vitest';
import { buildCommitsPromptInput } from '../src/ai/prompt.js';
import { extractJsonString } from '../src/ai/summarize.js';
import { parseDraftEditText, validateDraft } from '../src/utils/validate.js';

const longText = (label: string) =>
  `${label} dilakukan secara terstruktur meliputi perancangan modul, implementasi kode TypeScript, serta pengujian unit test untuk memastikan keandalan.`;

describe('validateDraft & parseDraftEditText', () => {
  it('menerima draf dengan seluruh field >= 100 karakter', () => {
    const result = validateDraft({
      aktivitas: longText('Aktivitas pengembangan'),
      pembelajaran: longText('Pembelajaran teknis'),
      kendala: longText('Kendala integrasi'),
    });
    expect(result.success).toBe(true);
  });

  it('menolak draf jika ada field < 100 karakter', () => {
    const result = validateDraft({
      aktivitas: 'Terlalu singkat',
      pembelajaran: longText('Pembelajaran teknis'),
      kendala: longText('Kendala integrasi'),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatch(/minimal 100 karakter/);
    }
  });

  it('mem-parsing teks edit parsial dan menggabungkan dengan draf lama', () => {
    const existing = {
      aktivitas: longText('Aktivitas awal'),
      pembelajaran: longText('Pembelajaran awal'),
      kendala: longText('Kendala awal'),
    };
    const newKendala = longText('Kendala baru setelah revisi');

    const { parsed, matchedAnyHeader } = parseDraftEditText(
      `Kendala: ${newKendala}`,
      existing,
    );

    expect(matchedAnyHeader).toBe(true);
    expect(parsed.aktivitas).toBe(existing.aktivitas);
    expect(parsed.pembelajaran).toBe(existing.pembelajaran);
    expect(parsed.kendala).toBe(newKendala);
  });

  it('membersihkan markdown fence pada JSON output Gemini', () => {
    const fenced = '```json\n{"aktivitas":"abc"}\n```';
    expect(extractJsonString(fenced)).toBe('{"aktivitas":"abc"}');
  });

  it('membentuk prompt input commit tanpa diff penuh', () => {
    const prompt = buildCommitsPromptInput('2026-11-25', [
      {
        repo: 'Rankarna01/monev-automate',
        sha: 'abc1234',
        message: 'feat(ai): add gemini summarizer',
        committedAt: '2026-11-25T10:00:00+07:00',
        files: ['src/ai/summarize.ts'],
      },
    ]);
    expect(prompt).toContain('Rankarna01/monev-automate');
    expect(prompt).toContain('src/ai/summarize.ts');
  });
});
