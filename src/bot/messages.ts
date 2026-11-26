import { InlineKeyboard } from 'grammy';
import type { AiQuotaStatus, UserRecord } from '../db/repo.js';
import { formatWibDateTime } from '../utils/time.js';
import type { ReportDraft } from '../utils/validate.js';

export const CALLBACK_ACTIONS = {
  SUMMARIZE: 'action:summarize',
  MANUAL_AI: 'action:manual_ai',
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
  MANUAL_AI: 'menu:manual_ai',
  GITHUB: 'menu:github',
  REPO: 'menu:repo',
  GEMINI: 'menu:gemini',
  RIWAYAT: 'menu:riwayat',
  SCHEDULE: 'menu:schedule',
  TUTORIAL: 'menu:tutorial',
} as const;

/**
 * Membuat inline keyboard untuk notifikasi pengingat harian.
 */
export function buildReminderKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📥 Dari GitHub', CALLBACK_ACTIONS.SUMMARIZE)
    .text('✍️ Catatan AI', CALLBACK_ACTIONS.MANUAL_AI)
    .row()
    .text('⏭️ Lewati', CALLBACK_ACTIONS.SKIP)
    .text('⏰ Ingatkan 30 menit', CALLBACK_ACTIONS.SNOOZE_30M);
}

/**
 * Membuat inline keyboard menu utama saat user menyapa ("halo", "/start", dll).
 */
export function buildGreetingMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Status & Kuota', MENU_ACTIONS.STATUS)
    .text('📋 Buat Laporan', MENU_ACTIONS.TES)
    .row()
    .text('✍️ Catatan AI', MENU_ACTIONS.MANUAL_AI)
    .text('🐙 Akun GitHub', MENU_ACTIONS.GITHUB)
    .row()
    .text('📚 Pilih Repo', MENU_ACTIONS.REPO)
    .text('🕒 Ubah Jam & Jadwal', MENU_ACTIONS.SCHEDULE)
    .row()
    .text('🗂️ Riwayat Laporan', MENU_ACTIONS.RIWAYAT)
    .text('📖 Tutorial', MENU_ACTIONS.TUTORIAL);
}

const SCHEDULE_TIME_OPTIONS = [
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
] as const;

/**
 * Membuat inline keyboard pilihan jam notifikasi langsung dari 14:00 sampai 17:00 WIB.
 */
export function buildScheduleKeyboard(activeTime: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  SCHEDULE_TIME_OPTIONS.forEach((time, index) => {
    const label = time === activeTime ? `✅ ${time}` : `🕒 ${time}`;
    keyboard.text(label, `set_jam:${time}`);
    if ((index + 1) % 3 === 0 && index < SCHEDULE_TIME_OPTIONS.length - 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

/**
 * Membuat inline keyboard untuk meninjau draf laporan hasil Gemini.
 */
export function buildDraftKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Setujui & Simpan', DRAFT_ACTIONS.APPROVE)
    .text('✏️ Edit', DRAFT_ACTIONS.EDIT)
    .row()
    .text('🔄 Buat Ulang', DRAFT_ACTIONS.REGENERATE)
    .text('❌ Batal', DRAFT_ACTIONS.CANCEL);
}

/**
 * Pesan sambutan & onboarding dinamis untuk /start (melampirkan Nama, Telegram ID, Kuota AI, dan Tutorial singkat).
 */
export function buildOnboardingStartMessage(
  user: UserRecord,
  quota: AiQuotaStatus,
  scheduleDaysLabel: string,
): string {
  const usernameText = user.telegram_username ? ` (@${user.telegram_username})` : '';
  return [
    '👋 *Selamat datang di Bot Laporan Harian Monev!*',
    '',
    '🪪 *Identitas Terdaftar (Otomatis Tersimpan):*',
    `• Nama: *${user.display_name}*${usernameText}`,
    `• Telegram ID: \`${user.telegram_chat_id}\``,
    `• Jadwal pengingat: *${user.schedule_time} WIB* (${scheduleDaysLabel})`,
    `• Sisa kuota AI hari ini: *${quota.remaining}/${quota.limit}*`,
    `• Waktu server: ${formatWibDateTime()}`,
    '',
    '📘 *Cara Pakai (Pilih Salah Satu atau Keduanya):*',
    '1. *Pakai GitHub:* Klik *🐙 Akun GitHub* → tautkan token/OAuth → pilih repo di *📚 Pilih Repo* → bot otomatis merangkum commit-mu.',
    '2. *Tanpa GitHub (Mode Catatan AI):* Klik *✍️ Catatan AI* → ketik poin singkat kegiatanmu hari ini → AI langsung mengembangkannya menjadi 3 kolom baku Monev (≥ 100 karakter).',
    '3. *Atur Jam Pengingat:* Klik *🕒 Ubah Jam & Jadwal* untuk memilih jam 14:00–17:00 WIB.',
    '',
    'Pilih menu di bawah ini untuk mulai 👇',
  ].join('\n');
}

/**
 * Panduan lengkap cara menyimpan & menggunakan fitur bot secara dinamis.
 */
export function buildTutorialMessage(user: UserRecord): string {
  return [
    '📖 *Tutorial & Panduan Dinamis Bot Monev*',
    `Akun: *${user.display_name}* (ID: \`${user.telegram_chat_id}\`)`,
    '',
    '1️⃣ *Simpan / Tautkan Akun GitHub (Opsional)*',
    '• Tidak wajib jika kamu ingin pakai Mode Catatan AI saja.',
    '• Jika ingin otomatis tarik commit: buat Fine-grained PAT (Read-only `Contents` & `Metadata`) di GitHub → kirim `/github token <PAT>` (atau `/github login` jika OAuth aktif).',
    '• Setelah terhubung, klik *📚 Pilih Repo* untuk memilih repo lewat tombol.',
    '',
    '2️⃣ *Buat Laporan Tanpa GitHub (Mode Catatan AI)*',
    '• Klik tombol *✍️ Catatan AI* → kirim kalimat singkat, contoh:',
    '  _"Ikut rapat sprint pagi, merapikan tampilan tabel karyawan, dan membantu uji coba API absensi."_',
    '• AI akan menyusun 3 kolom format Monev (Uraian aktivitas, Pembelajaran, Kendala) masing-masing ≥ 100 karakter.',
    '',
    '3️⃣ *Ubah Jadwal & Hari Aktif*',
    '• Klik *🕒 Ubah Jam & Jadwal* untuk pilih jam 14:00–17:00 WIB, atau kirim `/hari senin-jumat`.',
    '',
    '4️⃣ *Review & Salin ke Monev*',
    '• Gunakan tombol *✏️ Edit* atau *🔄 Buat Ulang* jika draf belum pas, lalu salin ke halaman Monev-mu.',
  ].join('\n');
}

/**
 * Pesan sapaan ramah beserta menu fungsi cepat.
 */
export function buildGreetingMessage(
  user: UserRecord,
  quota: AiQuotaStatus,
  scheduleDaysLabel: string,
): string {
  return [
    `👋 *Halo, ${user.display_name}!*`,
    `🕒 Jadwal: *${user.schedule_time} WIB* (${scheduleDaysLabel}) | 🧠 Kuota AI: *${quota.remaining}/${quota.limit}*`,
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
    'Pilih sumber pembuatan laporan hari ini:',
  ].join('\n');
}

/**
 * Memformat draf 3 field laporan untuk ditinjau di Telegram.
 */
export function buildDraftMessage(
  date: string,
  draft: ReportDraft,
  quota?: AiQuotaStatus,
): string {
  const lines = [
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
  ];

  if (quota) {
    lines.push('', `🧠 _Sisa kuota AI hari ini: ${quota.remaining}/${quota.limit}_`);
  }

  lines.push('', 'Silakan tinjau draf di atas:');
  return lines.join('\n');
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
