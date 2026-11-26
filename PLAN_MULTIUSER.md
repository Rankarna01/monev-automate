# PLAN MULTI-USER: Bot Laporan Harian Monev (Via Telegram)

> Pengembangan dari bot pribadi menjadi bot **multi-user langsung via Telegram** dengan pilihan fleksibel: **terhubung ke GitHub** atau **tanpa GitHub (Mode Catatan AI)**, serta onboarding otomatis yang melampirkan **Nama & Telegram ID** beserta tutorial dinamis.

---

## 1. Konsep Utama & Alur User Baru (`/start`)

Saat user baru membuka bot Telegram dan menekan **Start (`/start`)**:
1. **Registrasi Otomatis & Dinamis:**
   - Bot mengambil `telegram_chat_id`, `first_name` / `last_name`, dan `username` dari Telegram (`ctx.from`).
   - Data user langsung disimpan ke tabel `users` di **Supabase** secara dinamis (jika sudah terdaftar, data nama/username diperbarui jika berubah).
2. **Pesan Sambutan + Identitas + Tutorial:**
   - Bot membalas dengan:
     - **Profil Terdaftar:** menampilkan **Nama** dan **Telegram ID** milik user tersebut.
     - **Tutorial Singkat & Dinamis:** menjelaskan 2 cara membuat laporan (pakai GitHub atau langsung ketik poin kegiatan ke AI), cara mengatur jam notifikasi (`14:00–17:00 WIB`), serta cara menyalin draf ke Monev.
     - **Tombol Onboarding Cepat:**
       - `🐙 Hubungkan GitHub (Opsional)` → pilihan OAuth Browser (`/github login`) atau PAT
       - `✍️ Buat Laporan dari Catatan AI` → langsung ketik poin kegiatan tanpa GitHub
       - `🧠 Atur Gemini API Key` → opsional jika pakai key pribadi
       - `🕒 Atur Jam Pengingat` → pilih jam `14:00–17:00 WIB`
       - `📖 Panduan Lengkap` → membuka tutorial detail per fitur

---

## 2. Dua Opsi Sumber Laporan (+ Mode Gabungan)

Setiap user bebas memilih alur yang paling sesuai dengan pekerjaannya:

### Opsi A · Dengan Akun GitHub (OAuth / PAT)
- User menautkan akun GitHub pribadi lewat `/github login` (OAuth Device Flow di browser, mendukung login Google GitHub) atau `/github token <PAT>`.
- User memilih repository lewat tombol interaktif `/repo`.
- Saat waktunya laporan, bot menarik commit hari itu (pesan commit + nama file, tanpa diff) → Gemini merangkumnya menjadi 3 kolom format Monev.

### Opsi B · Tanpa GitHub (Mode Kembangkan Catatan AI)
- User **tidak perlu** menautkan akun GitHub sama sekali.
- User cukup memilih tombol **✍️ Tulis Catatan Kegiatan** (atau membalas pengingat harian) dan mengetik poin singkat apa adanya, misalnya:
  > *"hari ini ikut rapat sprint, merapikan tampilan tabel karyawan, dan bantu uji coba API absensi"*
- Gemini AI mengembangkan poin tersebut menjadi 3 kolom format baku Monev:
  1. **Uraian aktivitas** (≥ 100 karakter, bahasa Indonesia formal)
  2. **Pembelajaran yang diperoleh** (≥ 100 karakter)
  3. **Kendala yang dialami** (≥ 100 karakter, realistis sesuai konteks catatan)
- Bot tetap menampilkan tombol **✏️ Edit**, **🔄 Buat Ulang**, dan **📋 Salin Siap Pakai** sebelum user menempelkannya ke form Monev.

### Opsi C · Mode Gabungan (Hybrid)
- Jika user sudah menghubungkan GitHub **dan** ingin menambahkan aktivitas non-coding (misal rapat atau koordinasi tim), user bisa mengetik catatan tambahan sebelum AI menyusun draf gabungan.

---

## 3. Perubahan Arsitektur & Database (Supabase)

### Tabel Baru: `users`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | `BIGSERIAL PK` | ID internal user |
| `telegram_chat_id` | `BIGINT UNIQUE` | Identitas utama user di Telegram |
| `display_name` | `TEXT` | Nama user (dari Telegram, bisa diubah) |
| `telegram_username` | `TEXT` | `@username` Telegram (opsional) |
| `github_token_enc` | `TEXT` | Token GitHub terenkripsi AES-256-GCM (`NULL` jika tanpa GitHub) |
| `github_username` | `TEXT` | Username GitHub terhubung |
| `whitelisted_repos` | `JSONB` | Daftar repo aktif milik user |
| `gemini_api_key_enc` | `TEXT` | API key Gemini milik user (terenkripsi, opsional) |
| `gemini_model` | `TEXT` | Default `gemini-3.8-flash` |
| `schedule_time` | `VARCHAR(5)` | Default `16:00` |
| `schedule_days` | `JSONB` | Default `[1,2,3,4,5]` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | |

### Penyesuaian Tabel `reports`
- Tambah kolom `user_id` (`BIGINT REFERENCES users(id) ON DELETE CASCADE`).
- Tambah kolom `source_mode` (`'github' | 'manual_ai' | 'hybrid'`) dan `manual_notes` (`TEXT`).
- Ubah constraint unik dari `UNIQUE(date)` menjadi **`UNIQUE(user_id, date)`** agar laporan tiap user terisolasi.

---

## 4. Keamanan & Operasional Multi-User

- **Lepas Guard Single-User:** Middleware `bot.ts` mengizinkan semua `chat_id`, lalu memuat/mendaftarkan profil user ke konteks handler (`ctx.user`).
- **Enkripsi Token (`ENCRYPTION_KEY`):** Seluruh `github_token` dan `gemini_api_key` milik user dienkripsi dengan AES-256-GCM sebelum disimpan ke Supabase.
- **Kuota Gemini API:**
  - Disarankan tiap user bisa mengisi key sendiri (`/gemini key ...`), dengan opsi fallback ke key bersama milik admin (dibatasi kuota harian, mis. maks 5–10 generasi/hari per user).
- **Scheduler Multi-User (`/api/cron`):**
  - Saat cron berjalan, sistem mengambil user yang `schedule_days`-nya aktif hari ini (dan belum punya laporan hari ini), lalu mengirim pengingat ke masing-masing `telegram_chat_id`.
- **Pengisian Form Monev:**
  - Karena Monev memerlukan sesi login & koordinat perangkat asli masing-masing user, bot di Vercel menghasilkan **draf siap salin** untuk semua user (atau menyediakan format pesan yang mudah di-copy per kolom di Telegram).

---

## 5. Rencana Tahapan Implementasi

1. **Tahap 1 · Skema Supabase & Enkripsi:** Buat migrasi SQL tabel `users`, penyesuaian `reports(user_id, date)`, helper enkripsi AES-256-GCM, serta `userRepo`.
2. **Tahap 2 · Onboarding `/start` & Tutorial Dinamis:** Registrasi otomatis user baru, tampilkan Nama + Telegram ID + tutorial interaktif + menu tombol cepat per user.
3. **Tahap 3 · Isolasi Data Per User:** Ubah `/github`, `/repo`, `/gemini`, `/jam`, `/hari`, `/status`, `/riwayat` agar membaca/menulis ke baris `users` masing-masing.
4. **Tahap 4 · Mode Catatan AI (Tanpa GitHub) & Hybrid:** Tambah state `menunggu_catatan`, prompt pengembang poin kegiatan ke 3 kolom Monev (≥ 100 karakter), dan tombol salin/edit/buat ulang.
5. **Tahap 5 · Cron Multi-User & Deploy Vercel:** Perbarui `/api/cron` untuk mengirim notifikasi ke user yang jadwalnya aktif, uji coba dengan 2 akun Telegram berbeda, lalu deploy ke Vercel.
