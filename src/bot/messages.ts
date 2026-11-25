import { InlineKeyboard } from 'grammy';
import { formatWibDateTime } from '../utils/time.js';

export const CALLBACK_ACTIONS = {
  SUMMARIZE: 'action:summarize',
  SKIP: 'action:skip',
  SNOOZE_30M: 'action:snooze_30m',
} as const;

/**
 * Membuat inline keyboard untuk notifikasi pengingat harian.
 */
export function buildReminderKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📥 Buat Ringkasan', CALLBACK_ACTIONS.SUMMARIZE)
    .text('⏭️ Lewati', CALLBACK_ACTIONS.SKIP)
    .row()
    .text('⏰ Ingatkan 30 menit', CALLBACK_ACTIONS.SNOOZE_30M);
}

/**
 * Pesan sambutan untuk perintah /start.
 */
export function buildStartMessage(scheduleTime: string): string {
  return [
    '👋 *Bot Laporan Harian Monev aktif!*',
    '',
    `🕒 Jadwal pengingat harian: *${scheduleTime} WIB*`,
    `📅 Waktu server saat ini: ${formatWibDateTime()}`,
    '',
    'Perintah yang tersedia:',
    '• `/start` — Cek status bot hidup',
    '• `/status` — Cek status laporan hari ini',
    '• `/riwayat` — Lihat 7 laporan terakhir',
    '• `/tes` — Uji coba kirim tombol pengingat harian',
  ].join('\n');
}

/**
 * Pesan pengingat harian beserta instruksi singkat.
 */
export function buildReminderMessage(todayDate: string): string {
  return [
    '📋 *Waktunya laporan harian Monev*',
    `Tanggal: \`${todayDate}\``,
    '',
    'Silakan pilih aksi di bawah ini:',
  ].join('\n');
}
