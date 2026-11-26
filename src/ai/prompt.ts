import type { CommitSummaryItem } from '../github/commits.js';

export const SYSTEM_PROMPT = `Kamu adalah asisten yang menyusun laporan harian magang (Monev) dalam bahasa Indonesia yang formal, jelas, dan ringkas.

ATURAN WAJIB:
1. Gunakan HANYA informasi fakta dari daftar pekerjaan, catatan pengguna, dan daftar file yang diberikan. DILARANG mengarang pekerjaan atau fitur yang tidak ada pada sumber.
2. FOKUS PADA FITUR & FUNGSI: Jelaskan langsung fitur, modul, tampilan, kegiatan, atau perbaikan yang dikerjakan dan manfaatnya bagi pengguna/sistem.
3. LARANGAN ISTILAH GIT: JANGAN PERNAH menyebut kata "merge", "merging", "branch", "commit", "push", "pull request", "PR", "konflik kode", atau nama branch (seperti "staging", "main", "dev", atau nama orang/branch). Ubah pesan yang berasal dari aktivitas git menjadi deskripsi pekerjaan fitur secara langsung.
4. Keluarkan JSON murni dengan tepat tiga field: "aktivitas", "pembelajaran", dan "kendala".
5. Setiap field WAJIB memiliki panjang MINIMAL 100 karakter (disarankan 130-250 karakter agar informatif dan aman melewati batas 100 karakter).
6. Penjelasan tiap field:
   - aktivitas: Uraian langsung fitur/kegiatan kerja yang dikembangkan, dikerjakan, atau diperbaiki hari ini dengan bahasa formal dan terstruktur.
   - pembelajaran: Hal teknis, alur bisnis, koordinasi, atau konsep pengembangan yang dipelajari/diterapkan dari kegiatan tersebut (tanpa menyebut proses git/merge).
   - kendala: Hambatan teknis atau operasional yang wajar saat mengerjakan/menguji kegiatan tersebut (misalnya penyesuaian validasi data, integrasi antar komponen, klarifikasi kebutuhan, atau pengujian skenario). Jika tidak ada indikasi hambatan spesifik, tulis kendala umum yang jujur terkait pengembangan/pengujian fitur, BUKAN tentang merge/branch.`;

/**
 * Menyusun prompt input untuk Gemini dari daftar commit hari ini (tanpa diff penuh).
 */
export function buildCommitsPromptInput(
  date: string,
  commits: CommitSummaryItem[],
  retryHint?: string,
): string {
  const commitLines = commits.map((commit, idx) => {
    const filesText =
      commit.files.length > 0 ? commit.files.join(', ') : '(tidak ada daftar file)';
    return [
      `${idx + 1}. [${commit.repo}] (${commit.committedAt})`,
      `   Pesan: ${commit.message}`,
      `   File berubah: ${filesText}`,
    ].join('\n');
  });

  const sections = [
    `Tanggal laporan: ${date}`,
    `Total aktivitas tercatat: ${commits.length}`,
    '',
    'Daftar pekerjaan hari ini:',
    ...commitLines,
  ];

  if (retryHint) {
    sections.push('', `CATATAN PERBAIKAN (WAJIB DIPENUHI): ${retryHint}`);
  }

  return sections.join('\n');
}

/**
 * Menyusun prompt input untuk mengembangkan catatan singkat kegiatan harian menjadi format Monev
 * (mendukung mode tanpa GitHub maupun hybrid bersama commit GitHub).
 */
export function buildManualNotesPromptInput(
  date: string,
  manualNotes: string,
  commits: CommitSummaryItem[] = [],
  retryHint?: string,
): string {
  const sections = [
    `Tanggal laporan: ${date}`,
    'Mode: Kembangkan catatan kegiatan harian pengguna menjadi format baku Monev.',
    '',
    'Catatan kegiatan dari pengguna:',
    manualNotes.trim(),
  ];

  if (commits.length > 0) {
    const commitLines = commits.map(
      (c, idx) => `${idx + 1}. [${c.repo}] ${c.message}`,
    );
    sections.push('', 'Aktivitas teknis tambahan:', ...commitLines);
  }

  if (retryHint) {
    sections.push('', `CATATAN PERBAIKAN (WAJIB DIPENUHI): ${retryHint}`);
  }

  return sections.join('\n');
}
