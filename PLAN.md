# PLAN: Bot Laporan Harian Monev (GitHub → Gemini → Telegram → Monev)

> Asisten pribadi yang mengingatkan di jam yang kamu set, merangkum commit GitHub hari itu menjadi 3 isian laporan, menampilkannya di Telegram, lalu mengisi form Monev **hanya setelah kamu menekan Setujui**.

---

## 1. Ringkasan

| Item | Keterangan |
|---|---|
| Tujuan | Menghemat waktu mengisi laporan harian di Monev (MagangHub) |
| Pengguna | 1 orang (kamu sendiri) |
| Sumber data | Riwayat commit GitHub (repo yang di-whitelist) |
| Pembuat ringkasan | Gemini API |
| Antarmuka | Bot Telegram dengan tombol inline |
| Eksekusi ke Monev | Playwright memakai sesi login browser kamu sendiri |
| Tempat berjalan | Laptop/PC pribadi (bukan Vercel) |
| Prinsip utama | **Human-in-the-loop**: tidak ada yang terkirim ke Monev tanpa persetujuanmu |

### Field laporan Monev yang diisi

1. **Kehadiran** (default: `Hadir`)
2. **Uraian aktivitas** (minimal 100 karakter)
3. **Pembelajaran yang diperoleh** (minimal 100 karakter)
4. **Kendala yang dialami** (minimal 100 karakter)
5. Checkbox pernyataan "sudah meninjau dan memastikan isian benar" (dicentang **setelah kamu menyetujui draf**)

---

## 2. Aturan Main (Guardrails)

Aturan ini bagian dari desain, bukan opsional.

- [ ] Tidak ada submit tanpa tombol **Setujui & Kirim** dari kamu.
- [ ] Tidak ada commit hari itu → **tidak ada laporan** (bot tidak boleh mengarang).
- [ ] Hanya `chat_id` Telegram milikmu yang bisa mengendalikan bot.
- [ ] Hanya repo di whitelist yang dibaca, dengan token **read-only**.
- [ ] Lokasi mengikuti perangkat aslimu. **Tidak ada pemalsuan koordinat/GPS.**
- [ ] Bot dijalankan hanya pada hari kamu memang hadir. Status kehadiran adalah tanggung jawabmu.
- [ ] Hanya pesan commit dan daftar file yang dikirim ke Gemini, bukan seluruh diff (mencegah secret bocor, hemat biaya).

---

## 3. Alur Kerja

```
[Scheduler: jam yang kamu set, mis. 14:00]
        │
        ▼
[Telegram] "Waktunya laporan harian 📋"
   [📥 Buat Ringkasan]  [⏭️ Lewati]  [⏰ Ingatkan 30 menit]
        │ klik "Buat Ringkasan"
        ▼
[GitHub API] ambil commit hari ini (repo whitelist, author = kamu)
        │
   ada commit? ── tidak ──► [Telegram] "Tidak ada commit hari ini" ──► selesai
        │ ya
        ▼
[Gemini API] buat 3 ringkasan + validasi ≥ 100 karakter (retry jika kurang)
        │
        ▼
[Telegram] tampilkan draf:
   📌 Uraian aktivitas   📚 Pembelajaran   ⚠️ Kendala
   [✅ Setujui & Kirim]  [✏️ Edit]  [🔄 Buat Ulang]  [❌ Batal]
        │ klik "Setujui & Kirim"
        ▼
[Playwright] buka Monev (sesi login tersimpan) → isi field → centang → Simpan dan Kirim
        │
        ▼
[Telegram] "✅ Terkirim" + screenshot bukti
           atau "❌ Gagal: <alasan>" (mis. sesi habis, login ulang dulu)
```

### Diagram status (state machine)

| Status | Arti | Aksi yang tersedia |
|---|---|---|
| `menunggu_trigger` | Notifikasi terjadwal terkirim | Buat Ringkasan / Lewati / Tunda |
| `mengambil_data` | Sedang tarik commit + panggil Gemini | - |
| `draf_siap` | Draf ditampilkan | Setujui / Edit / Buat Ulang / Batal |
| `menunggu_edit` | Bot menunggu teks revisimu | Balas teks → kembali ke `draf_siap` |
| `mengirim` | Playwright sedang berjalan | - |
| `terkirim` | Sukses | - |
| `gagal` | Error (disertai alasan) | Coba Lagi / Batal |
| `dilewati` | Kamu memilih lewati | - |
| `kedaluwarsa` | Tidak ada respons sampai batas waktu | - |

---

## 4. Tech Stack

| Lapisan | Teknologi | Fungsi |
|---|---|---|
| Runtime & bahasa | **Node.js 20+ dengan TypeScript** | Basis proyek |
| Bot Telegram | **grammY** | Tombol inline, callback, perintah |
| Scheduler | **node-cron** | Memicu notifikasi di jam yang diset |
| GitHub | **Octokit** (`@octokit/rest`) + fine-grained PAT (read-only) | Ambil commit |
| AI | **Google Gen AI SDK** (`@google/genai`) | Membuat 3 ringkasan |
| Otomasi browser | **Playwright** (`launchPersistentContext`) | Isi form & submit di Monev |
| Penyimpanan | **MySQL** (`mysql2`) | Status, draf, riwayat, pengaturan |
| Validasi | **zod** | Validasi env, output AI, input |
| Logging | **pino** | Log terstruktur |
| Konfigurasi | **dotenv** | Menyimpan token di `.env` |
| Proses manager | **pm2** (atau launchd/Task Scheduler) | Menjaga bot tetap hidup & auto-start |
| Test | **vitest** | Unit test logika inti |

**Kenapa long polling, bukan webhook:** bot menarik pesan dari Telegram sendiri, jadi tidak perlu URL publik atau tunnel. Cocok untuk berjalan di laptop.

**Alternatif:** n8n self-hosted (visual, tanpa banyak kode), tapi butuh webhook publik/tunnel untuk tombol Telegram. Rencana ini memakai kode sendiri karena lebih sederhana untuk satu pengguna.

---

## 5. Struktur Proyek

```
monev-bot/
├─ src/
│  ├─ index.ts              # entry point: jalankan bot + scheduler
│  ├─ config.ts             # baca & validasi .env (zod)
│  ├─ bot/
│  │  ├─ bot.ts             # inisialisasi grammY, guard chat_id
│  │  ├─ commands.ts        # /start /jam /repo /status /riwayat /tes
│  │  ├─ callbacks.ts       # handler tombol inline
│  │  └─ messages.ts        # template pesan & keyboard
│  ├─ scheduler/
│  │  └─ cron.ts            # daftar & reload jadwal
│  ├─ github/
│  │  └─ commits.ts         # ambil commit hari ini per repo
│  ├─ ai/
│  │  ├─ summarize.ts       # panggil Gemini, parse JSON, validasi
│  │  └─ prompt.ts          # system prompt & aturan
│  ├─ monev/
│  │  ├─ submit.ts          # Playwright: isi & kirim form
│  │  ├─ selectors.ts       # semua selector di satu tempat
│  │  └─ session.ts         # cek sesi login valid
│  ├─ db/
│  │  ├─ db.ts              # koneksi MySQL & migrasi
│  │  ├─ stateMachine.ts    # aturan transisi status laporan
│  │  └─ repo.ts            # query: reports, settings
│  └─ utils/
│     ├─ time.ts            # zona waktu WIB (GMT+7)
│     └─ validate.ts        # cek min. 100 karakter
├─ data/
│  └─ browser-profile/      # profil Playwright (cookie login), JANGAN di-commit
├─ tests/
├─ .env.example
├─ .gitignore               # wajib: .env, data/
├─ package.json
└─ PLAN.md
```

---

## 6. Model Data (MySQL)

**`settings`**

| kolom | tipe | catatan |
|---|---|---|
| `key_name` | VARCHAR(100) PK | `schedule_time`, `schedule_days`, `repos`, `timeout_hours` |
| `value` | TEXT | nilai (JSON bila perlu) |

**`reports`**

| kolom | tipe | catatan |
|---|---|---|
| `id` | INT AUTO_INCREMENT PK | |
| `date` | VARCHAR(10) UNIQUE | `YYYY-MM-DD`, unik per hari |
| `status` | VARCHAR(32) | lihat tabel status |
| `commits_json` | LONGTEXT | ringkas: pesan + file, bukan diff |
| `aktivitas` | TEXT | draf uraian aktivitas |
| `pembelajaran` | TEXT | draf pembelajaran |
| `kendala` | TEXT | draf kendala |
| `telegram_message_id` | BIGINT | untuk memperbarui pesan & menonaktifkan tombol lama |
| `error` | TEXT | alasan jika gagal |
| `created_at` / `updated_at` / `submitted_at` | DATETIME | |

---

## 7. Perintah Telegram

| Perintah | Fungsi |
|---|---|
| `/start` | Cek bot hidup |
| `/jam 14:00` | Ubah jam notifikasi harian |
| `/hari senin-jumat` | Atur hari aktif |
| `/repo tambah owner/nama` | Tambah repo ke whitelist |
| `/repo hapus owner/nama` | Hapus repo dari whitelist |
| `/repo` | Lihat daftar repo |
| `/status` | Status laporan hari ini |
| `/riwayat` | 7 laporan terakhir |
| `/tes` | Picu alur sekarang (untuk uji coba) |

---

## 8. Rencana Task (Per Fase)

### Fase 0 · Persiapan
- [ ] Buat repo `monev-bot` (private) dan inisialisasi Node.js + TypeScript
- [ ] Pasang dependensi: grammy, node-cron, @octokit/rest, @google/genai, playwright, better-sqlite3, zod, pino, dotenv, vitest
- [ ] Buat bot di `@BotFather`, simpan token
- [ ] Ambil `chat_id` pribadi
- [ ] Buat **fine-grained PAT** GitHub: hanya repo terpilih, izin `Contents: read` + `Metadata: read`
- [ ] Buat API key Gemini (Google AI Studio)
- [ ] Isi `.env`, pastikan `.env` dan `data/` masuk `.gitignore`
- [ ] Siapkan `config.ts` dengan validasi zod

**Selesai jika:** `npm run dev` berjalan dan config terbaca tanpa error.

### Fase 1 · Bot Telegram & Alur Tombol
- [ ] Inisialisasi grammY + **guard `chat_id`** (tolak semua selain kamu)
- [ ] Perintah `/start`, `/status`
- [ ] Kirim pesan dengan inline keyboard (Buat Ringkasan / Lewati / Tunda)
- [ ] Handler callback untuk tiap tombol
- [ ] Nonaktifkan tombol lama setelah dipakai (edit pesan)

**Selesai jika:** tombol merespons dan orang lain tidak bisa memakai bot.

### Fase 2 · Database & State Machine
- [ ] Skema SQLite + migrasi otomatis saat start
- [ ] Fungsi `getTodayReport`, `updateStatus`, `saveDraft`
- [ ] Aturan transisi status (tidak boleh lompat, mis. dari `terkirim` kembali ke `draf_siap`)
- [ ] Pulihkan status saat bot restart

**Selesai jika:** restart bot di tengah alur tidak menghilangkan posisi.

### Fase 3 · Scheduler
- [ ] `node-cron` dengan zona waktu `Asia/Jakarta`
- [ ] Jadwal dibaca dari `settings`
- [ ] Perintah `/jam` dan `/hari` memperbarui jadwal tanpa restart
- [ ] Pastikan satu notifikasi per hari (cegah dobel)
- [ ] Logika "Tunda 30 menit" dan batas waktu → `kedaluwarsa`

**Selesai jika:** notifikasi muncul tepat di jam yang diset dan bisa diubah lewat chat.

### Fase 4 · Integrasi GitHub
- [ ] Ambil commit hari ini (zona WIB) per repo whitelist, filter `author`
- [ ] Ambil daftar file yang berubah (nama file saja, tanpa diff penuh)
- [ ] Gabungkan lintas repo, urutkan berdasarkan waktu
- [ ] Tangani: tidak ada commit, rate limit, token salah
- [ ] Unit test dengan data tiruan

**Selesai jika:** `/tes` menampilkan jumlah commit yang benar per repo.

### Fase 5 · Ringkasan Gemini
- [ ] Susun system prompt: bahasa Indonesia, gaya formal ringkas, hanya berdasarkan fakta commit
- [ ] Minta output JSON `{ aktivitas, pembelajaran, kendala }` (manfaatkan `responseMimeType: "application/json"`)
- [ ] Validasi dengan zod + **cek min. 100 karakter** tiap field
- [ ] Retry otomatis (maks. 2x) bila terlalu pendek atau JSON rusak
- [ ] Aturan "jangan mengarang": jika data kurang, tulis kendala yang jujur dan umum, bukan fiktif
- [ ] Tampilkan draf di Telegram dengan tombol Setujui / Edit / Buat Ulang / Batal
- [ ] Alur **Edit**: bot menunggu teks revisi, validasi ulang, tampilkan lagi
- [ ] Alur **Buat Ulang**: panggil Gemini lagi, draf lama tidak bisa disetujui

**Selesai jika:** 10 hari uji berturut-turut menghasilkan draf valid ≥ 100 karakter dan sesuai commit.

### Fase 6 · Otomasi Monev (Playwright)
- [ ] Login manual sekali dengan `launchPersistentContext` (`data/browser-profile`), sesi tersimpan
- [ ] Kumpulkan struktur halaman form, simpan selector di `selectors.ts`
- [ ] Fungsi `checkSession()`: deteksi sesi habis lebih dulu, kirim notifikasi "login ulang dulu"
- [ ] Fungsi `submitReport(draft)`: pilih Kehadiran, isi 3 kolom, centang pernyataan, klik **Simpan dan Kirim**
- [ ] Tunggu dan verifikasi tanda sukses (pesan/halaman konfirmasi)
- [ ] Ambil screenshot sebelum dan sesudah kirim, kirim ke Telegram
- [ ] Timeout, retry terbatas, dan penanganan error yang jelas
- [ ] Mode `DRY_RUN=true`: isi form tapi **berhenti sebelum klik kirim** (untuk uji coba)

**Selesai jika:** mode dry-run mengisi form dengan benar 5 kali berturut-turut, lalu 1 kirim sungguhan berhasil.

### Fase 7 · Hardening & Operasional
- [ ] Notifikasi error ke Telegram untuk semua kegagalan (GitHub, Gemini, Monev)
- [ ] Cegah submit ganda (kunci per tanggal)
- [ ] Logging pino ke file + rotasi
- [ ] Jalankan lewat **pm2** dengan auto-start saat laptop menyala
- [ ] Tulis README singkat: cara setup, cara login ulang Monev, cara ganti jadwal
- [ ] Unit test: validasi karakter, state machine, parsing commit

**Selesai jika:** bot hidup stabil 1 minggu tanpa intervensi kecuali tombol Setujui.

---

## 9. Variabel Lingkungan (`.env.example`)

```env
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# GitHub (fine-grained PAT, read-only, repo terpilih)
GITHUB_TOKEN=
GITHUB_USERNAME=
GITHUB_REPOS=owner/repo1,owner/repo2

# Gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# Monev
MONEV_URL=
BROWSER_PROFILE_DIR=./data/browser-profile
DRY_RUN=true

# Umum
TZ=Asia/Jakarta
SCHEDULE_TIME=14:00
APPROVAL_TIMEOUT_HOURS=3
```

---

## 10. Contoh Rancangan Prompt Gemini

**System prompt (garis besar):**

```
Kamu membantu menyusun laporan harian magang dalam bahasa Indonesia formal dan ringkas.
Gunakan HANYA informasi dari daftar commit yang diberikan. Jangan menambahkan pekerjaan
yang tidak ada di commit. Keluarkan JSON saja dengan tiga field:
- aktivitas: uraian pekerjaan hari ini (min. 100 karakter)
- pembelajaran: hal teknis yang dipelajari, disimpulkan dari commit (min. 100 karakter)
- kendala: hambatan yang masuk akal berdasarkan commit (mis. bug, refactor, perbaikan);
  jika tidak ada indikasi, tulis kendala umum yang jujur, bukan yang dikarang (min. 100 karakter)
```

**Input per panggilan:** tanggal, daftar commit (pesan + waktu + repo), daftar file yang berubah.

---

## 11. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Tampilan form Monev berubah | Script gagal | Selector di satu file, notifikasi error + screenshot, dry-run rutin |
| Sesi login Monev habis | Submit gagal | `checkSession()` sebelum kirim, notifikasi "login ulang" |
| Captcha/OTP muncul | Otomasi terblokir | Fallback: bot kirim draf, kamu salin manual |
| Laptop mati/offline saat jadwal | Notifikasi terlewat | Pengingat saat bot hidup kembali, pm2 auto-start |
| Token bocor | Akses tak sah | `.env` di `.gitignore`, PAT read-only repo terbatas, guard `chat_id` |
| Draf AI salah/mengarang | Laporan tidak akurat | Wajib review manual, prompt "hanya dari commit", tombol Edit |
| Tidak ada commit | Laporan kosong | Skip otomatis, tidak ada draf |
| Dobel submit | Laporan duplikat | Kunci per tanggal + tombol dinonaktifkan |
| Biaya API membengkak | Tagihan | Kirim ringkas (tanpa diff), 1 panggilan per hari, batas retry |

---

## 12. Estimasi Biaya

| Komponen | Perkiraan |
|---|---|
| Hosting | Gratis (jalan di laptop sendiri) |
| Telegram Bot | Gratis |
| GitHub API | Gratis |
| SQLite, Playwright, grammY, dll. | Gratis (open source) |
| Gemini API | Sangat kecil / gratis (free tier): sekitar 1 panggilan per hari dengan input pendek |

---

## 13. Definition of Done

- [ ] Notifikasi muncul di jam yang diset dan bisa diubah via `/jam`
- [ ] Klik "Buat Ringkasan" menarik commit & menampilkan 3 draf valid (≥ 100 karakter)
- [ ] Tombol Edit, Buat Ulang, dan Batal bekerja
- [ ] Tombol "Setujui & Kirim" memproses form Monev dan mengirim bukti screenshot
- [ ] Tidak ada submit tanpa persetujuan; tidak ada laporan saat tanpa commit
- [ ] Hanya chat_id pemilik yang bisa mengendalikan bot
- [ ] Error apa pun dilaporkan ke Telegram, bukan gagal diam-diam
- [ ] Bot hidup otomatis setelah restart

---

## 14. Urutan Pengerjaan yang Disarankan

1. **Fase 0 → 1 → 2**: bot + tombol + state (bisa diuji tanpa GitHub/Gemini/Monev)
2. **Fase 3**: scheduler
3. **Fase 4 → 5**: GitHub + Gemini (hasil sudah berguna: draf bisa disalin manual ke Monev)
4. **Fase 6**: Playwright dengan `DRY_RUN=true` dulu
5. **Fase 7**: hardening, lalu matikan `DRY_RUN`

> Titik berhenti yang aman: setelah Fase 5 kamu sudah punya asisten yang menghasilkan draf siap salin. Fase 6 adalah bonus otomasi dan bagian yang paling mungkin memerlukan perawatan.

---

## 15. Catatan Penting

- Checkbox "saya menyatakan telah meninjau dan memastikan isian benar" hanya dicentang **setelah kamu menekan Setujui**, jadi pernyataan itu tetap benar karena kamu memang sudah membaca drafnya.
- Pastikan penggunaan otomasi ini tidak bertentangan dengan aturan program magang/Monev yang kamu ikuti. Cek ketentuan resminya bila ragu.
