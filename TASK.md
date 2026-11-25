# TASK: Implementasi Bot Laporan Harian Monev

Dokumen ini memecah [PLAN.md](file:///Users/calvin/KINRA/monev-automate/PLAN.md) menjadi checklist pengerjaan bertahap untuk sistem **Bot Laporan Harian Monev** (`GitHub → Gemini → Telegram → Monev`) dengan prinsip utama **human-in-the-loop**.

---

## Ringkasan Arsitektur & Tech Stack Awal

- **Alur Utama:** `Scheduler (node-cron)` → `Notifikasi Telegram (grammY)` → `Tarik Commit (Octokit)` → `Ringkasan & Validasi ≥100 karakter (Google Gen AI SDK + zod)` → `Review & Persetujuan User di Telegram` → `Isi & Submit Form Monev (Playwright persistent context)` → `Bukti Screenshot ke Telegram`
- **Penyimpanan & State:** `MySQL` (`mysql2`) untuk state machine harian (`menunggu_trigger` → `mengambil_data` → `draf_siap` / `menunggu_edit` → `mengirim` → `terkirim` / `gagal` / `dilewati` / `kedaluwarsa`), draf, dan pengaturan.
- **Tech Stack Inti:** Node.js 20+ (TypeScript), `grammY` (long polling), `node-cron` (`Asia/Jakarta`), `@octokit/rest`, `@google/genai`, `playwright`, `mysql2`, `zod`, `pino`, `dotenv`, `vitest`, `pm2`.
- **Urutan Pengerjaan Disarankan:** `Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6 (DRY_RUN=true) → Fase 7`.

---

## Fase 0 · Persiapan & Setup Proyek

**Target:** Fondasi TypeScript, dependensi, kredensial, dan validasi konfigurasi siap dijalankan.

- [x] Inisialisasi proyek Node.js 20+ dengan TypeScript (`package.json`, `tsconfig.json`, script `dev`, `build`, `test`)
- [ ] Pasang dependensi utama: `grammy`, `node-cron`, `@octokit/rest`, `@google/genai`, `playwright`, `better-sqlite3`, `zod`, `pino`, `dotenv` *(sudah terpasang: `grammy`, `zod`, `pino`, `dotenv`; sisanya dipasang per fase)*
- [ ] Pasang devDependencies: `typescript`, `tsx`, `@types/node`, `@types/better-sqlite3`, `@types/node-cron`, `vitest` *(sudah terpasang: `typescript`, `tsx`, `@types/node`, `vitest`)*
- [x] Buat struktur direktori awal (`src/bot`, `src/utils`, `tests/`)
- [ ] Buat bot Telegram via `@BotFather` dan catat `TELEGRAM_BOT_TOKEN`
- [ ] Dapatkan `TELEGRAM_CHAT_ID` pribadi
- [ ] Buat GitHub fine-grained PAT (read-only: `Contents: read`, `Metadata: read`) khusus repo whitelist
- [ ] Siapkan `GEMINI_API_KEY` (Google AI Studio)
- [x] Buat `.env.example` dan `.env` (template siap diisi, termasuk `TZ=Asia/Jakarta`, `DRY_RUN=true`)
- [x] Pastikan `.gitignore` mengecualikan `.env`, `data/`, `node_modules/`, `dist/`
- [x] Implementasikan `src/config.ts` dengan validasi `zod` untuk seluruh env vars
- [x] Implementasikan logger dasar dengan `pino` dan helper zona waktu `src/utils/time.ts` (WIB / `Asia/Jakarta`)

**Kriteria Selesai:** `npm run dev` berjalan tanpa error dan konfigurasi `.env` tervalidasi oleh `zod`.

---

## Fase 1 · Bot Telegram & Alur Tombol

**Target:** Bot merespons via long polling, terkunci hanya untuk `chat_id` pemilik, dan tombol inline bekerja.

- [x] Inisialisasi bot `grammY` di `src/bot/bot.ts` (mode long polling)
- [x] Tambahkan middleware guard `chat_id` untuk menolak seluruh akses dari selain `TELEGRAM_CHAT_ID`
- [x] Implementasikan template pesan & inline keyboard di `src/bot/messages.ts`
- [x] Implementasikan perintah dasar `/start`, `/status`, dan `/tes` di `src/bot/commands.ts`
- [x] Implementasikan pengiriman pesan pengingat harian dengan tombol: `Buat Ringkasan`, `Lewati`, `Ingatkan 30 menit`
- [x] Implementasikan handler callback tombol inline di `src/bot/callbacks.ts`
- [x] Pastikan tombol lama dinonaktifkan (edit pesan) setelah diklik agar tidak memicu aksi ganda

**Kriteria Selesai:** Bot membalas perintah pemilik, menolak `chat_id` lain, dan tombol inline merespons serta menonaktifkan tombol lama.

---

## Fase 2 · Database & State Machine (MySQL)

**Target:** State laporan harian tersimpan persisten di MySQL dengan transisi status yang aman.

- [x] Implementasikan koneksi MySQL (`mysql2/promise`) & migrasi otomatis tabel `settings` dan `reports` di `src/db/db.ts`
- [x] Implementasikan aturan validasi transisi state machine di `src/db/stateMachine.ts` (`menunggu_trigger`, `mengambil_data`, `draf_siap`, `menunggu_edit`, `mengirim`, `terkirim`, `gagal`, `dilewati`, `kedaluwarsa`) agar tidak bisa melompat (mis. `terkirim` tidak bisa kembali ke `draf_siap`)
- [x] Implementasikan query repository di `src/db/repo.ts`: `getTodayReport`, `createTodayReport`, `updateStatus`, `saveDraft`, `getSetting`, `setSetting`, `getRecentReports`
- [x] Implementasikan mekanisme pemulihan state saat bot restart (termasuk membaca `telegram_message_id` terakhir)
- [x] Hubungkan perintah `/status` dan `/riwayat` (7 laporan terakhir) ke database MySQL

**Kriteria Selesai:** Restart bot di tengah alur tidak menghilangkan status maupun draf laporan hari itu.

---

## Fase 3 · Scheduler & Pengaturan Dinamis

**Target:** Pengingat harian berjalan otomatis sesuai jadwal WIB dan bisa diubah langsung dari Telegram.

- [x] Implementasikan `src/scheduler/cron.ts` menggunakan `node-cron` dengan timezone `Asia/Jakarta`
- [x] Muat konfigurasi jadwal (`schedule_time`, `schedule_days`, `timeout_hours`) dari tabel `settings` (fallback ke `.env`)
- [x] Implementasikan perintah `/jam <HH:MM>` dan `/hari <rentang/daftar>` untuk memperbarui jadwal secara dinamis tanpa restart bot
- [x] Pastikan hanya 1 notifikasi terkirim per hari (cegah duplikasi)
- [x] Implementasikan logika tombol `Ingatkan 30 menit` (tunda notifikasi)
- [x] Implementasikan pengecekan batas waktu (`APPROVAL_TIMEOUT_HOURS`) → transisi ke status `kedaluwarsa`
- [x] Tambahkan fallback pengingat jika bot sempat mati/offline saat jam jadwal dan baru hidup kembali di hari yang sama

**Kriteria Selesai:** Notifikasi muncul otomatis di jam yang diset, bisa diubah via chat, dan tidak terkirim ganda.

---

## Fase 4 · Integrasi GitHub

**Target:** Mengambil commit hari ini (WIB) dari repo whitelist secara aman (hanya pesan commit & daftar file, tanpa diff).

- [x] Implementasikan `src/github/auth.ts` (OAuth Device Flow `/github login` & PAT `/github token`) dan `src/github/commits.ts` menggunakan `@octokit/rest`
- [x] Implementasikan manajemen whitelist repo dari perintah `/repo` (tombol inline toggle + `tambah` / `hapus`) yang tersimpan di `settings`
- [x] Ambil commit berdasarkan rentang tanggal hari ini dalam zona WIB (`Asia/Jakarta`) dan filter `author` sesuai `GITHUB_USERNAME`
- [x] Ambil daftar nama file yang berubah per commit (tanpa isi diff penuh)
- [x] Gabungkan hasil commit lintas repo whitelist dan urutkan berdasarkan waktu
- [x] Tangani kondisi: tidak ada commit hari itu (hentikan alur & kirim info ke Telegram), rate limit, atau token tidak valid
- [x] Tulis unit test parsing & pengurutan commit dengan data tiruan (`vitest`)

**Kriteria Selesai:** Perintah `/tes` menarik dan menampilkan jumlah commit yang akurat per repo untuk hari ini.

---

## Fase 5 · Ringkasan Gemini & Alur Review Draf

**Target:** Menghasilkan 3 field laporan valid (≥ 100 karakter) berbasis fakta commit, lengkap dengan alur Edit & Buat Ulang.

> *Catatan: Setelah fase ini selesai, sistem sudah usable untuk menghasilkan draf siap salin manual ke Monev.*

- [ ] Susun system prompt & formatter input di `src/ai/prompt.ts` (bahasa Indonesia formal ringkas, hanya berdasarkan fakta commit, output JSON `{ aktivitas, pembelajaran, kendala }`)
- [ ] Implementasikan `src/utils/validate.ts` untuk memvalidasi panjang minimal 100 karakter pada tiap field
- [ ] Implementasikan `src/ai/summarize.ts` menggunakan `@google/genai` (`responseMimeType: "application/json"`), parse JSON + validasi schema `zod` + cek ≥ 100 karakter
- [ ] Tambahkan mekanisme retry otomatis (maksimal 2x) jika output bukan JSON valid atau ada field < 100 karakter
- [ ] Tampilkan draf (`aktivitas`, `pembelajaran`, `kendala`) ke Telegram dengan tombol: `Setujui & Kirim`, `Edit`, `Buat Ulang`, `Batal`
- [ ] Implementasikan alur **Edit** (`menunggu_edit` → terima teks revisi user → validasi ulang → kembali ke `draf_siap`)
- [ ] Implementasikan alur **Buat Ulang** (panggil ulang Gemini, nonaktifkan tombol draf lama)
- [ ] Implementasikan alur **Batal**

**Kriteria Selesai:** Pengujian menghasilkan draf JSON valid dengan seluruh field ≥ 100 karakter sesuai isi commit, serta alur Edit/Buat Ulang/Batal berfungsi penuh.

---

## Fase 6 · Otomasi Monev (Playwright)

**Target:** Mengisi dan mengirim form Monev secara aman hanya setelah tombol `Setujui & Kirim` ditekan.

- [ ] Siapkan script/langkah login manual pertama kali menggunakan `launchPersistentContext` (`data/browser-profile`) agar sesi login tersimpan
- [ ] Inspeksi DOM halaman form Monev dan kumpulkan seluruh selector di `src/monev/selectors.ts`
- [ ] Implementasikan `src/monev/session.ts` (`checkSession()`) untuk mendeteksi sesi login habis sebelum mengisi form dan mengirim notifikasi `"login ulang dulu"` ke Telegram
- [ ] Implementasikan `src/monev/submit.ts` (`submitReport(draft)`):
  - Pilih kehadiran (`Hadir`)
  - Isi `Uraian aktivitas`, `Pembelajaran`, dan `Kendala`
  - Centang checkbox pernyataan peninjauan
  - Hormati mode `DRY_RUN=true` (berhenti sebelum klik `Simpan dan Kirim`)
  - Klik `Simpan dan Kirim` saat `DRY_RUN=false` dan verifikasi halaman/pesan sukses
- [ ] Tangkap screenshot sebelum dan sesudah submit (atau saat error) lalu kirim ke Telegram
- [ ] Tambahkan timeout, retry terbatas, dan deteksi fallback jika muncul CAPTCHA/OTP (berhenti & minta user salin manual)
- [ ] Hubungkan callback `Setujui & Kirim` ke `submitReport()` dengan transisi state `mengirim` → `terkirim` / `gagal`

**Kriteria Selesai:** Mode `DRY_RUN=true` berhasil mengisi form dengan akurat 5x berturut-turut, lalu 1x kirim sungguhan (`DRY_RUN=false`) berhasil dengan bukti screenshot di Telegram.

---

## Fase 7 · Hardening, Testing & Operasional

**Target:** Bot tangguh berjalan otomatis di background laptop/PC dengan logging dan pengujian lengkap.

- [ ] Pastikan seluruh error (GitHub, Gemini, Playwright, SQLite) terkirim sebagai notifikasi yang jelas ke Telegram
- [ ] Verifikasi proteksi anti-submit ganda (kunci per tanggal di DB + disable tombol)
- [ ] Konfigurasikan `pino` untuk menulis log terstruktur ke file dengan rotasi log
- [ ] Lengkapi unit test di `tests/` dengan `vitest` (validasi ≥ 100 karakter, transisi state machine, parsing commit)
- [ ] Siapkan konfigurasi `pm2` (`ecosystem.config.cjs`) + auto-start saat laptop menyala
- [ ] Tulis `README.md` (panduan setup `.env`, cara login ulang profil Playwright Monev, daftar perintah Telegram, dan troubleshooting)
- [ ] Ubah `DRY_RUN=false` dan pantau operasional harian selama 1 minggu

**Kriteria Selesai:** Seluruh Definition of Done di `PLAN.md` terpenuhi dan bot berjalan stabil tanpa intervensi selain menekan tombol persetujuan.
