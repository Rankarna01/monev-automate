import { InlineKeyboard } from 'grammy';
import type { AccessibleRepo } from '../github/commits.js';

const PAGE_SIZE = 8;

/**
 * Cache sementara daftar repo GitHub untuk menjaga panjang callback_data Telegram (maks 64 byte).
 */
let cachedRepos: AccessibleRepo[] = [];

export function setCachedRepos(repos: AccessibleRepo[]): void {
  cachedRepos = repos;
}

export function getCachedRepos(): AccessibleRepo[] {
  return cachedRepos;
}

/**
 * Membangun inline keyboard toggle repo whitelist dengan pagination.
 */
export function buildRepoSelectionKeyboard(
  repos: AccessibleRepo[],
  whitelisted: string[],
  page: number = 0,
): { keyboard: InlineKeyboard; totalPages: number; currentPage: number } {
  const totalPages = Math.max(1, Math.ceil(repos.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const slice = repos.slice(start, start + PAGE_SIZE);

  const keyboard = new InlineKeyboard();
  const whitelistSet = new Set(whitelisted);

  slice.forEach((item, offset) => {
    const globalIdx = start + offset;
    const isActive = whitelistSet.has(item.fullName);
    const prefix = isActive ? '✅' : '⬜';
    const lock = item.isPrivate ? ' 🔒' : '';
    keyboard.text(`${prefix} ${item.fullName}${lock}`, `repo_tg:${globalIdx}:${currentPage}`).row();
  });

  if (totalPages > 1) {
    if (currentPage > 0) {
      keyboard.text('⬅️ Sebelumnya', `repo_page:${currentPage - 1}`);
    }
    if (currentPage < totalPages - 1) {
      keyboard.text('Berikutnya ➡️', `repo_page:${currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard.text('✔️ Selesai', 'repo_done');

  return { keyboard, totalPages, currentPage };
}
