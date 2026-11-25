import { describe, expect, it } from 'vitest';
import {
  buildCronExpression,
  formatScheduleDays,
  isScheduledTimePassedToday,
  parseScheduleDays,
  parseScheduleTime,
} from '../src/scheduler/scheduleParser.js';

describe('scheduleParser', () => {
  it('mem-parsing jam valid dan memformat dua digit', () => {
    expect(parseScheduleTime('9:05')).toEqual({
      hour: 9,
      minute: 5,
      formatted: '09:05',
    });
    expect(parseScheduleTime('14:30')).toEqual({
      hour: 14,
      minute: 30,
      formatted: '14:30',
    });
    expect(() => parseScheduleTime('25:00')).toThrow();
    expect(() => parseScheduleTime('abc')).toThrow();
  });

  it('mem-parsing rentang dan daftar hari Indonesia', () => {
    expect(parseScheduleDays('senin-jumat')).toEqual([1, 2, 3, 4, 5]);
    expect(parseScheduleDays('senin,rabu,jumat')).toEqual([1, 3, 5]);
    expect(parseScheduleDays('setiap hari')).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(formatScheduleDays([1, 2, 3, 4, 5])).toBe('Senin–Jumat');
    expect(formatScheduleDays([1, 3, 5])).toBe('Senin, Rabu, Jumat');
  });

  it('membangun ekspresi cron dan mengecek waktu terlewat di WIB', () => {
    expect(buildCronExpression(14, 0, [1, 2, 3, 4, 5])).toBe('0 14 * * 1,2,3,4,5');

    // 2026-11-25 (Rabu / day 3) pukul 15:00 WIB = 08:00 UTC
    const wib1500 = new Date('2026-11-25T08:00:00.000Z');
    expect(isScheduledTimePassedToday(14, 0, [1, 2, 3, 4, 5], wib1500)).toBe(true);
    expect(isScheduledTimePassedToday(16, 0, [1, 2, 3, 4, 5], wib1500)).toBe(false);
    expect(isScheduledTimePassedToday(14, 0, [1, 2], wib1500)).toBe(false);
  });
});
