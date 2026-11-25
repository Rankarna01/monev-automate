export const REPORT_STATUSES = [
  'menunggu_trigger',
  'mengambil_data',
  'draf_siap',
  'menunggu_edit',
  'mengirim',
  'terkirim',
  'gagal',
  'dilewati',
  'kedaluwarsa',
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  menunggu_trigger: ['mengambil_data', 'dilewati', 'kedaluwarsa', 'gagal'],
  mengambil_data: ['draf_siap', 'dilewati', 'gagal'],
  draf_siap: ['menunggu_edit', 'mengambil_data', 'mengirim', 'dilewati', 'kedaluwarsa', 'gagal'],
  menunggu_edit: ['draf_siap', 'dilewati', 'kedaluwarsa', 'gagal'],
  mengirim: ['terkirim', 'gagal'],
  gagal: ['mengambil_data', 'draf_siap', 'mengirim', 'dilewati'],
  terkirim: [],
  dilewati: [],
  kedaluwarsa: [],
};

/**
 * Mengecek apakah transisi dari status `from` ke `to` diperbolehkan.
 */
export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Memvalidasi transisi status laporan; melempar error jika transisi tidak sah.
 */
export function assertValidTransition(from: ReportStatus, to: ReportStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transisi status tidak valid: "${from}" -> "${to}"`);
  }
}

/**
 * Mengembalikan label status yang ramah dibaca di Telegram.
 */
export function formatStatusLabel(status: ReportStatus): string {
  const labels: Record<ReportStatus, string> = {
    menunggu_trigger: '⏳ Menunggu aksi',
    mengambil_data: '🔄 Mengambil data & merangkum',
    draf_siap: '📝 Draf siap ditinjau',
    menunggu_edit: '✏️ Menunggu teks revisi',
    mengirim: '🚀 Sedang mengirim ke Monev',
    terkirim: '✅ Terkirim',
    gagal: '❌ Gagal',
    dilewati: '⏭️ Dilewati',
    kedaluwarsa: '⌛ Kedaluwarsa',
  };
  return labels[status];
}
