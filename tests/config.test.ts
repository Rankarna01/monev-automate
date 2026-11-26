import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('memuat konfigurasi valid dengan default', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
      TELEGRAM_CHAT_ID: '987654321',
    });

    expect(config.TELEGRAM_BOT_TOKEN).toBe('123456:ABC-DEF');
    expect(config.TELEGRAM_CHAT_ID).toBe(987654321);
    expect(config.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(config.TZ).toBe('Asia/Jakarta');
    expect(config.SCHEDULE_TIME).toBe('16:00');
    expect(config.DRY_RUN).toBe(false);
  });

  it('mem-parsing GITHUB_REPOS dan DRY_RUN=true dengan benar', () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
      TELEGRAM_CHAT_ID: '987654321',
      GITHUB_REPOS: 'owner/repo1, owner/repo2',
      DRY_RUN: 'true',
    });

    expect(config.GITHUB_REPOS).toEqual(['owner/repo1', 'owner/repo2']);
    expect(config.DRY_RUN).toBe(true);
  });

  it('melempar error jika TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID kosong', () => {
    expect(() => loadConfig({})).toThrow(/Konfigurasi \.env tidak valid/);
  });
});
