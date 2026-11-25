import { describe, expect, it } from 'vitest';
import { getTodayWibDate } from '../src/utils/time.js';

describe('getTodayWibDate', () => {
  it('mengembalikan format YYYY-MM-DD sesuai zona waktu WIB (GMT+7)', () => {
    // 2026-11-24T20:00:00Z = 2026-11-25T03:00:00+07:00 (WIB)
    const utcDate = new Date('2026-11-24T20:00:00.000Z');
    expect(getTodayWibDate(utcDate)).toBe('2026-11-25');
  });
});
