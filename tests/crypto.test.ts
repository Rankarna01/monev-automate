import { describe, expect, it } from 'vitest';
import { buildManualNotesPromptInput } from '../src/ai/prompt.js';
import { decryptSecret, encryptSecret } from '../src/utils/crypto.js';

describe('crypto & manual notes prompt', () => {
  it('mengenkripsi dan mendekripsi token sensitif dengan benar', () => {
    const secret = 'my-super-secret-key';
    const token = 'github_pat_1234567890abcdef';

    const encrypted = encryptSecret(token, secret);
    expect(encrypted).not.toBe(token);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptSecret(encrypted, secret);
    expect(decrypted).toBe(token);
  });

  it('melempar error jika secret dekripsi salah', () => {
    const encrypted = encryptSecret('rahasia', 'kunci-benar');
    expect(() => decryptSecret(encrypted, 'kunci-salah')).toThrow();
  });

  it('menyusun prompt catatan kegiatan manual untuk Gemini', () => {
    const prompt = buildManualNotesPromptInput(
      '2026-11-26',
      'Rapat sprint pagi dan memperbaiki tampilan tabel.',
    );
    expect(prompt).toContain('2026-11-26');
    expect(prompt).toContain('Rapat sprint pagi');
  });
});
