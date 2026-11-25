const WIB_TIMEZONE = 'Asia/Jakarta';

/**
 * Mengembalikan tanggal hari ini dalam format YYYY-MM-DD (zona waktu WIB / Asia/Jakarta).
 */
export function getTodayWibDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}

/**
 * Memformat tanggal dan waktu ke string yang mudah dibaca dalam zona WIB.
 */
export function formatWibDateTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB_TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}
