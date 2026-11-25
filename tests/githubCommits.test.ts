import { describe, expect, it } from 'vitest';
import {
  getWibDayRange,
  parseRepoFullName,
  sortCommitsChronologically,
  type CommitSummaryItem,
} from '../src/github/commits.js';

describe('github commits helpers', () => {
  it('menghitung rentang hari WIB dengan benar', () => {
    expect(getWibDayRange('2026-11-25')).toEqual({
      since: '2026-11-25T00:00:00+07:00',
      until: '2026-11-25T23:59:59+07:00',
    });
    expect(() => getWibDayRange('25-11-2026')).toThrow();
  });

  it('mem-parsing format owner/nama repo dengan validasi', () => {
    expect(parseRepoFullName('Rankarna01/monev-automate')).toEqual({
      owner: 'Rankarna01',
      repo: 'monev-automate',
    });
    expect(() => parseRepoFullName('invalid-repo')).toThrow();
  });

  it('mengurutkan commit lintas repo secara kronologis', () => {
    const items: CommitSummaryItem[] = [
      {
        repo: 'owner/b',
        sha: '2222222',
        message: 'feat: kedua',
        committedAt: '2026-11-25T10:00:00+07:00',
        files: ['b.ts'],
      },
      {
        repo: 'owner/a',
        sha: '1111111',
        message: 'feat: pertama',
        committedAt: '2026-11-25T08:30:00+07:00',
        files: ['a.ts'],
      },
    ];

    const sorted = sortCommitsChronologically(items);
    expect(sorted.map((c) => c.sha)).toEqual(['1111111', '2222222']);
  });
});
