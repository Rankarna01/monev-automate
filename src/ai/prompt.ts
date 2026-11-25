import type { CommitSummaryItem } from '../github/commits.js';

export const SYSTEM_PROMPT = `Kamu adalah asisten yang menyusun laporan harian magang (Monev) dalam bahasa Indonesia yang formal, jelas, dan ringkas.

ATURAN WAJIB:
1. Gunakan HANYA informasi fakta dari daftar pekerjaan dan daftar file yang diberikan. DILARANG menambahkan pekerjaan atau fitur yang tidak ada pada sumber.
2. FOKUS PADA FITUR & FUNGSI: Jelaskan langsung fitur, modul, tampilan, atau perbaikan yang dikerjakan dan manfaatnya bagi pengguna/sistem.
3. LARANGAN ISTILAH GIT: JANGAN PERNAH menyebut kata "merge", "merging", "branch", "commit", "push", "pull request", "PR", "konflik kode", atau nama branch (seperti "staging", "main", "dev", atau nama orang/branch). Ubah pesan yang berasal dari aktivitas git menjadi deskripsi pekerjaan fitur secara langsung.
4. Keluarkan JSON murni dengan tepat tiga field: "aktivitas", "pembelajaran", dan "kendala".
5. Setiap field WAJIB memiliki panjang MINIMAL 100 karakter (disarankan 130-250 karakter agar informatif dan aman melewati batas 100 karakter).
6. Penjelasan tiap field:
   - aktivitas: Uraian langsung fitur/pekerjaan teknis yang dikembangkan atau diperbaiki hari ini (contoh: "Mengimplementasikan fitur sinkronisasi data kontrak...", "Menambahkan pagination pada halaman...").
   - pembelajaran: Hal teknis, alur bisnis, atau konsep pengembangan aplikasi yang dipelajari/diterapkan dari fitur tersebut (tanpa menyebut proses git/merge).
   - kendala: Hambatan teknis atau fungsional yang wajar saat membangun/menguji fitur tersebut (misalnya penyesuaian validasi data, integrasi antar komponen, atau pengujian skenario edge-case). Jika tidak ada indikasi hambatan spesifik, tulis kendala umum yang jujur terkait pengembangan/pengujian fitur, BUKAN tentang merge/branch.`;

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
    `Total commit: ${commits.length}`,
    '',
    'Daftar commit hari ini:',
    ...commitLines,
  ];

  if (retryHint) {
    sections.push(
      '',
      `CATATAN PERBAIKAN (WAJIB DIPENUHI): ${retryHint}`,
    );
  }

  return sections.join('\n');
}
