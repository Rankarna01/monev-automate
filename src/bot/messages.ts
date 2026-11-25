import { InlineKeyboard } from 'grammy';
import { formatWibDateTime } from '../utils/time.js';
import type { ReportDraft } from '../utils/validate.js';

export const CALLBACK_ACTIONS = {
  SUMMARIZE: 'action:summarize',
  SKIP: 'action:skip',
  SNOOZE_30M: 'action:snooze_30m',
} as const;

export const DRAFT_ACTIONS = {
  APPROVE: 'draft:approve',
  EDIT: 'draft:edit',
  REGENERATE: 'draft:regenerate',
  CANCEL: 'draft:cancel',
} as const;

export const MENU_ACTIONS = {
  STATUS: 'menu:status',
  TES: 'menu:tes',
  GITHUB: 'menu:github',
  REPO: 'menu:repo',
  GEMINI: 'menu:gemini',
  RIWAYAT: 'menu:riwayat',
  SCHEDULE: 'menu:schedule',
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
 * Membuat inline keyboard menu utama saat user menyapa ("halo", "menu", dll).
 */
export function buildGreetingMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Status Hari Ini', MENU_ACTIONS.STATUS)
    .text('📋 Mulai / Tes Laporan', MENU_ACTIONS.TES)
    .row()
    .text('🐙 Akun GitHub', MENU_ACTIONS.GITHUB)
    .text('📚 Pilih Repo', MENU_ACTIONS.REPO)
    .row()
    .text('🧠 Gemini AI', MENU_ACTIONS.GEMINI)
    .text('🗂️ Riwayat Laporan', MENU_ACTIONS.RIWAYAT)
    .row()
    .text('🕒 Info Jadwal', MENU_ACTIONS.SCHEDULE);
}

/**
 * Membuat inline keyboard untuk meninjau draf laporan hasil Gemini.
 */
export function buildDraftKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Setujui & Kirim', DRAFT_ACTIONS.APPROVE)
    .text('✏️ Edit', DRAFT_ACTIONS.EDIT)
    .row()
    .text('🔄 Buat Ulang', DRAFT_ACTIONS.REGENERATE)
    .text('❌ Batal', DRAFT_ACTIONS.CANCEL);
}

/**
 * Pesan sambutan untuk perintah /start.
 */
export function buildStartMessage(scheduleTime: string, scheduleDaysLabel?: string): string {
  const daysPart = scheduleDaysLabel ? ` (${scheduleDaysLabel})` : '';
  return [
    '👋 *Bot Laporan Harian Monev aktif!*',
    '',
    `🕒 Jadwal pengingat harian: *${scheduleTime} WIB*${daysPart}`,
    `📅 Waktu server saat ini: ${formatWibDateTime()}`,
    '',
    'Perintah yang tersedia:',
    '• `/start` — Cek status bot hidup',
    '• `/status` — Cek status laporan hari ini',
    '• `/jam <HH:MM>` — Ubah jam pengingat harian',
    '• `/hari <hari>` — Atur hari aktif (mis. `senin-jumat`)',
    '• `/github` — Hubungkan / cek akun GitHub',
    '• `/repo` — Pilih repo whitelist lewat tombol',
    '• `/gemini` — Atur API Key & model Gemini',
    '• `/riwayat` — Lihat 7 laporan terakhir',
    '• `/tes` — Uji coba kirim tombol pengingat harian',
    '',
    '💡 *Tips:* Kirim `halo` kapan saja untuk membuka menu tombol cepat.',
  ].join('\n');
}

/**
 * Pesan sapaan ramah beserta menu fungsi cepat.
 */
export function buildGreetingMessage(scheduleTime: string, scheduleDaysLabel: string): string {
  return [
    '👋 *Halo! Ada yang bisa dibantu hari ini?*',
    `🕒 Jadwal laporan aktif: *${scheduleTime} WIB* (${scheduleDaysLabel})`,
    '',
    'Pilih fungsi di bawah ini:',
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

/**
 * Memformat draf 3 field laporan untuk ditinjau di Telegram.
 */
export function buildDraftMessage(date: string, draft: ReportDraft): string {
  return [
    `📝 *Draf Laporan Harian (\`${date}\`)*`,
    '',
    `📌 *Uraian Aktivitas* (${draft.aktivitas.length} karakter):`,
    draft.aktivitas,
    '',
    `📚 *Pembelajaran yang Diperoleh* (${draft.pembelajaran.length} karakter):`,
    draft.pembelajaran,
    '',
    `⚠️ *Kendala yang Dialami* (${draft.kendala.length} karakter):`,
    draft.kendala,
    '',
    'Silakan tinjau draf di atas sebelum dikirim ke Monev:',
  ].join('\n');
}

/**
 * Pesan instruksi saat user memilih Edit draf.
 */
export function buildEditInstructionMessage(draft: ReportDraft): string {
  return [
    '✏️ *Mode Edit Draf*',
    'Balas pesan ini dengan field yang ingin diubah (boleh satu field saja atau ketiganya, minimal 100 karakter per field).',
    '',
    'Contoh format:',
    '```',
    `Aktivitas: ${draft.aktivitas}`,
    '',
    `Pembelajaran: ${draft.pembelajaran}`,
    '',
    `Kendala: ${draft.kendala}`,
    '```',
  ].join('\n');
}
