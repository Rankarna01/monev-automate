const DAY_NAME_TO_CRON: Record<string, number> = {
  minggu: 0,
  ahad: 0,
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
};

const CRON_TO_DAY_NAME: Record<number, string> = {
  0: 'Minggu',
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu',
};

export interface ParsedTime {
  hour: number;
  minute: number;
  formatted: string;
}

/**
 * Mem-parsing string jam berformat HH:MM (00:00 - 23:59).
 */
export function parseScheduleTime(input: string): ParsedTime {
  const trimmed = input.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new Error('Format jam tidak valid. Gunakan format HH:MM, contoh: 14:00');
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Jam harus antara 00:00 sampai 23:59.');
  }

  const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { hour, minute, formatted };
}

function parseSingleDayToken(token: string): number {
  const normalized = token.trim().toLowerCase();
  if (/^[0-6]$/.test(normalized)) {
    return Number(normalized);
  }
  const day = DAY_NAME_TO_CRON[normalized];
  if (day === undefined) {
    throw new Error(
      `Nama hari tidak dikenal: "${token}". Gunakan contoh: senin-jumat atau senin,rabu,jumat`,
    );
  }
  return day;
}

/**
 * Mem-parsing input hari aktif menjadi array angka cron (0=Minggu .. 6=Sabtu) terurut & unik.
 * Mendukung: "senin-jumat", "senin,rabu,jumat", "setiap hari", atau angka "1-5".
 */
export function parseScheduleDays(input: string): number[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Hari tidak boleh kosong.');
  }

  if (normalized === 'setiap hari' || normalized === 'semua') {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const result = new Set<number>();
  const parts = normalized.split(',').map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startRaw, endRaw, ...rest] = part.split('-').map((s) => s.trim());
      if (!startRaw || !endRaw || rest.length > 0) {
        throw new Error(`Rentang hari tidak valid: "${part}"`);
      }
      const start = parseSingleDayToken(startRaw);
      const end = parseSingleDayToken(endRaw);

      if (start <= end) {
        for (let d = start; d <= end; d++) {
          result.add(d);
        }
      } else {
        // Wrap-around, misal jumat-senin
        for (let d = start; d <= 6; d++) {
          result.add(d);
        }
        for (let d = 0; d <= end; d++) {
          result.add(d);
        }
      }
    } else {
      result.add(parseSingleDayToken(part));
    }
  }

  if (result.size === 0) {
    throw new Error('Tidak ada hari valid yang ditemukan.');
  }

  return Array.from(result).sort((a, b) => a - b);
}

/**
 * Memformat array angka hari cron menjadi teks bahasa Indonesia yang mudah dibaca.
 */
export function formatScheduleDays(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (sorted.length === 7) return 'Setiap hari';
  if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'Senin–Jumat';
  if (sorted.length === 6 && sorted.join(',') === '1,2,3,4,5,6') return 'Senin–Sabtu';
  return sorted.map((d) => CRON_TO_DAY_NAME[d] ?? String(d)).join(', ');
}

/**
 * Membangun ekspresi cron 5-kolom untuk node-cron.
 */
export function buildCronExpression(
  hour: number,
  minute: number,
  days: number[],
): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  return `${minute} ${hour} * * ${sorted.join(',')}`;
}

/**
 * Mengecek apakah waktu sekarang (WIB) sudah melewati jam jadwal pada hari aktif.
 */
export function isScheduledTimePassedToday(
  hour: number,
  minute: number,
  days: number[],
  now: Date = new Date(),
): boolean {
  const wibString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  const wibDate = new Date(wibString);

  const currentDay = wibDate.getDay();
  if (!days.includes(currentDay)) {
    return false;
  }

  const currentMinutes = wibDate.getHours() * 60 + wibDate.getMinutes();
  const scheduledMinutes = hour * 60 + minute;
  return currentMinutes >= scheduledMinutes;
}
