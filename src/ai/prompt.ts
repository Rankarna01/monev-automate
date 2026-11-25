import type { CommitSummaryItem } from '../github/commits.js';

export const SYSTEM_PROMPT = `Kamu adalah asisten yang menyusun laporan harian magang (Monev) dalam bahasa Indonesia yang formal, jelas, dan ringkas.

ATURAN WAJIB:
1. Gunakan HANYA informasi fakta dari daftar commit dan daftar file yang diberikan. DILARANG menambahkan pekerjaan atau fitur yang tidak ada pada commit.
2. Keluarkan JSON murni dengan tepat tiga field: "aktivitas", "pembelajaran", dan "kendala".
3. Setiap field WAJIB memiliki panjang MINIMAL 100 karakter (lebih disarankan 130-250 karakter agar informatif dan aman melewati batas 100 karakter).
4. Penjelasan tiap field:
   - aktivitas: Uraian pekerjaan teknis yang dikerjakan hari ini berdasarkan pesan commit dan file yang diubah.
   - pembelajaran: Hal teknis atau konsep rekayasa perangkat lunak yang dipelajari/diterapkan, disimpulkan secara logis dari commit tersebut.
   - kendala: Hambatan teknis yang masuk akal berdasarkan konteks commit (misalnya penyesuaian struktur kode, debugging, validasi, integrasi API). Jika tidak ada indikasi hambatan spesifik, tulis kendala umum yang jujur dan realistis terkait proses pengembangan/pengujian, BUKAN mengarang insiden fiktif.`;

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
