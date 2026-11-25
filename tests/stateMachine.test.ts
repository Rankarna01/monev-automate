import { describe, expect, it } from 'vitest';
import { assertValidTransition, canTransition } from '../src/db/stateMachine.js';

describe('stateMachine', () => {
  it('mengizinkan alur normal hingga terkirim', () => {
    expect(canTransition('menunggu_trigger', 'mengambil_data')).toBe(true);
    expect(canTransition('mengambil_data', 'draf_siap')).toBe(true);
    expect(canTransition('draf_siap', 'menunggu_edit')).toBe(true);
    expect(canTransition('menunggu_edit', 'draf_siap')).toBe(true);
    expect(canTransition('draf_siap', 'mengirim')).toBe(true);
    expect(canTransition('mengirim', 'terkirim')).toBe(true);
  });

  it('menolak transisi lompat atau mundur dari status terminal', () => {
    expect(canTransition('terkirim', 'draf_siap')).toBe(false);
    expect(canTransition('dilewati', 'mengambil_data')).toBe(false);
    expect(canTransition('kedaluwarsa', 'draf_siap')).toBe(false);
    expect(canTransition('menunggu_trigger', 'terkirim')).toBe(false);
  });

  it('melempar error pada assertValidTransition yang tidak sah', () => {
    expect(() => assertValidTransition('terkirim', 'draf_siap')).toThrow(
      /Transisi status tidak valid/,
    );
  });
});
