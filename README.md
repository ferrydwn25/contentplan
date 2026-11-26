# ContentPlan Enterprise

Aplikasi perencanaan dan penjadwalan konten multi-brand untuk YouTube,
Instagram, TikTok, dan Threads. Live di `contentplanz.vercel.app`.

> **Status keamanan (penting):** aplikasi ini masih dalam proses hardening.
> Baca bagian "Keamanan" sebelum memakai di produksi, dan selesaikan
> langkah "Yang masih harus dilakukan Ferry" di bawah.

## Arsitektur

```
Browser (public/index.html, single-file)
  └─> Vercel Serverless (/api/*)
        ├─> /api/gas-proxy  ──> Google Apps Script Web App
        │                      └─> Google Sheets "Content Plan - Database"
        ├─> /api/oauth      ──> OAuth 2.0 platform sosial ──> GAS
        ├─> /api/social-sync ──> API platform sosial + GAS
        └─> /api/cron-publish (dipicu eksternal, BUKAN Vercel Cron)
```

- **Frontend:** `public/index.html` — satu file, Tailwind via CDN, Chart.js.
  Menu: Swipe (Batch AI), Kalender, Feeds & Grid, Buat Post, Learning &
  Brand DNA, Balasan, Analitik, Aset & Drive, Pengaturan & Slot.
- **Backend Vercel:** `api/` — serverless functions tanpa dependensi
  (tidak ada `package.json`).
- **Backend GAS:** Google Apps Script yang terikat ke Sheets
  "Content Plan - Database" (15 tab). Lihat `gas/Code.gs` — itu **DRAFT**,
  bukan kode GAS asli Ferry. Kode asli belum ditinjau; jangan ganti kode
  asli dengan draft ini tanpa membandingkannya dulu.
- **Database:** Sheets, locale `in_ID`, zona waktu `Asia/Jakarta`.
  Tab inti: `CONTENTS`, `ACCOUNTS`, `SETTINGS`, `CAMPAIGNS`,
  `CONTENT_METRICS`, `ACCOUNT_METRICS`, `MEDIA_LIBRARY`, `IMPORT_LOG`,
  `ACTIVITY_LOG`, `NOTIFICATIONS`, `SCHEDULE_SLOTS`, `BRAND_CONTEXT`,
  `OAUTH_CONNECTIONS`, `UNIFIED_INBOX`.

## Kontrak API (jangan diubah tanpa dokumentasi)

Frontend hanya memanggil GAS lewat `/api/gas-proxy`:

- `GET /api/gas-proxy?api=bootstrap` — mengembalikan `brands`, `slots`,
  `contents`, `assets`, `connections` (metadata saja, **tanpa token**),
  dan `inbox`.
- `POST /api/gas-proxy` dengan `action` salah satu dari:
  `disconnect_oauth`, `generate_batch`, `delete_post`, `ai_caption`,
  `save_composer_post`, `upload_asset`, `toggle_slot`, `delete_slot`,
  `add_slot`, `save_brand_context`, `delete_brand_context`,
  `learn_brand_style`.

Pemanggil server-ke-server (bukan lewat proxy):

- `/api/oauth` memanggil GAS `POST` action `save_oauth_connection`.
- `/api/social-sync` memanggil GAS `GET api=oauth_tokens` dan `POST`
  action `save_oauth_connection`, `sync_inbox_batch`, `reply_inbox`.
- `/api/cron-publish` memanggil GAS `GET api=due_posts` dan — hanya bila
  ada publikasi nyata yang berhasil — `POST` action
  `mark_published_by_cron`.

## Setup

1. Clone repo ini.
2. Salin `.env.example` menjadi `.env` **lokal saja** (jangan commit),
   lalu isi nilainya. Daftar variabel ada di `.env.example`.
3. Di Vercel, set Environment Variables yang sama (Production).
4. Di Apps Script yang terikat ke Sheets, set Script Property
   `GAS_API_SECRET` dengan nilai yang **sama** dengan di Vercel.
5. Deploy GAS sebagai Web App (Execute as: Me, Who has access: Anyone),
   salin URL `/exec` ke `GAS_WEB_APP_URL` di Vercel.
6. Deploy ulang di Vercel.

## Environment Variables

Lihat `.env.example` — file itu hanya berisi **nama variabel, tanpa nilai**.
Yang wajib diisi di Vercel:

| Variabel | Untuk |
| --- | --- |
| `GAS_WEB_APP_URL` | URL Web App GAS (`/exec`) |
| `GAS_API_SECRET` | Secret bersama Vercel ↔ GAS |
| `CRON_SECRET` | Secret khusus pemicu `/api/cron-publish` dari luar |
| `META_APP_ID`, `META_IG_CONFIG_ID`, `META_APP_SECRET` | Instagram / Threads via Meta |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Threads (boleh sama dengan kredensial Meta) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube via Google |

Tidak ada nilai fallback di kode. Bila sebuah env belum diset, endpoint
terkait mengembalikan error yang jelas, bukan memakai nilai bawaan.

## Keamanan

Yang sudah diperbaiki dalam hardening ini:

- Semua client ID / secret / config ID hanya dari env — tidak ada lagi
  nilai yang tertulis di kode repo publik.
- State OAuth divalidasi (platform dikenal, brand valid, nonce, masa
  berlaku 15 menit). Catatan: validasi ini stateless; perlindungan CSRF
  penuh membutuhkan penyimpanan server-side (cookie terenkripsi / KV).
- `/api/gas-proxy` memakai allowlist: GET hanya `bootstrap`; POST hanya
  12 action frontend. Endpoint server-side (`oauth_tokens`, `due_posts`)
  dan action server-side (`save_oauth_connection`, `sync_inbox_batch`,
  `reply_inbox`, `mark_published_by_cron`) ditolak lewat proxy.
- Security headers di `vercel.json` (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
  CSP belum ditambahkan karena frontend memakai CDN (Tailwind, Phosphor,
  Chart.js, Google Fonts) — CSP perlu daftar allowlist dan pengujian
  sebelum diaktifkan, agar tidak merusak aplikasi live.
- Draft GAS (`gas/Code.gs`) memvalidasi secret di setiap request,
  memakai allowlist, menyimpan token di Script Properties (bukan teks
  biasa di Sheets), dan tidak mengembalikan token lewat `bootstrap`.

Yang **belum** selesai dan masih berisiko:

- **Aplikasi belum punya login.** Siapa pun yang membuka URL live bisa
  melihat dan mengubah semua brand/konten. Tambahkan autentikasi
  sebelum dipakai bersama orang lain.
- **Token OAuth lama pernah tersimpan sebagai teks biasa di Sheets.**
  Token-token itu harus dirotasi dan kolom token lama dikosongkan —
  memindahkan penyimpanan ke Script Properties tidak otomatis
  membatalkan token lama yang sudah bocor ke Sheets.
- Token Threads yang lama sudah kedaluwarsa (20 Nov 2026) — hubungkan
  ulang Threads, dan hubungkan Instagram yang belum terhubung.

## Cron eksternal (bukan Vercel Cron)

Akun Vercel Ferry adalah **paket gratis, dan Vercel Cron tidak berjalan
di paket gratis**. Karena itu `vercel.json` di repo ini **sengaja tidak**
berisi `crons`. Endpoint `/api/cron-publish` dipicu dari luar:

1. Set `CRON_SECRET` di Vercel (string acak panjang).
2. Di layanan cron eksternal pilihan Ferry (misalnya layanan penjadwal
   HTTP / cron-job eksternal), buat jadwal tiap jam yang memanggil:
   `GET https://contentplanz.vercel.app/api/cron-publish`
   dengan header `Authorization: Bearer <CRON_SECRET>`
   (atau header `x-cron-secret: <CRON_SECRET>`).
3. Periksa responsnya: `dueCount`, `publishedCount`, dan `skipped`.

Perilaku cron saat ini (penting): endpoint **tidak menandai konten
sebagai Published tanpa publikasi nyata yang berhasil**. Publikasi
otomatis per platform belum diimplementasikan — fungsi `publishPost()`
di `api/cron-publish.js` adalah titik ekstensi yang sengaja
mengembalikan "belum diimplementasikan", dan `publishedCount` akan
tetap 0 sampai implementasi itu ada dan teruji. Jangan memanggil
`mark_published_by_cron` secara manual untuk konten yang belum terbit.

## Analitik: angka retensi adalah ESTIMASI

Skor retensi / hook rate di Analitik **bukan data retensi asli** dari
platform. Nilainya dihitung dari rumus estimasi berbasis engagement
rate, dan sekarang ditandai secara eksplisit di respons API
(`retentionEstimated: true`, `retentionIsEstimate: true`) serta di teks
insight. Jangan menggunakannya sebagai laporan retensi resmi.
Data nyata yang dipakai: followers, views/reach, likes, comments,
shares, dan engagement rate dari API tiap platform.

## Skill yang direncanakan (belum terhubung ke API sosial)

Dua skill ini dicatat sebagai rencana fitur di README — **bukan** klaim
sudah terhubung:

- **Social publishing** — generator draft hook, caption, dan hashtag
  dari Brand DNA (`ai_caption`, `generate_batch`), dengan aturan:
  draft selalu menunggu persetujuan Ferry di Composer sebelum
  dijadwalkan atau dipublikasikan. Tidak ada publikasi otomatis
  tanpa persetujuan.
- **Social content performance** — analitik nyata per platform,
  konten performa tertinggi, dan waktu posting terbaik dari
  `SCHEDULE_SLOTS` + data performa historis. Saat ini analitik
  memakai data API langsung (bukan rekomendasi otomatis), dan skor
  retensi tetap berlabel ESTIMASI seperti di atas.

## Verifikasi setelah deploy

1. Buka `contentplanz.vercel.app` — harus termuat tanpa error,
   indikator sync hijau ("Vercel Edge Live").
2. Kalender menampilkan brand dan slot yang sudah ada; Analitik
   menampilkan angka dari API (bukan 0 semua bila akun terhubung).
3. Coba hubungkan ulang Threads — harus berhasil tanpa error state.
4. Panggil `/api/gas-proxy?api=oauth_tokens` dari browser — harus
   ditolak 403 (endpoint itu tidak boleh lewat proxy).
5. Panggil `/api/cron-publish` tanpa secret (bila `CRON_SECRET`
   diset) — harus 401; dengan secret yang benar — harus 200 dengan
   `publishedCount: 0` sampai publikasi nyata diimplementasikan.
6. Periksa tab `ACTIVITY_LOG` di Sheets — aksi tulis dari draft GAS
   tercatat di sana.

## Yang masih harus dilakukan Ferry

- Lengkapi instalasi GitHub App untuk repo ini agar perubahan bisa
  di-push lewat API (saat ini tulis ditolak 403).
- Tempel / bandingkan draft `gas/Code.gs` dengan kode GAS asli, lalu
  deploy sendiri dari Apps Script.
- Rotasi token OAuth lama; hubungkan ulang Threads dan Instagram.
- Set `CRON_SECRET` dan jadwalkan pemicu eksternal tiap jam.
- Isi data inti di Sheets (`CONTENTS`, `ACCOUNTS`, `SETTINGS`,
  `CAMPAIGNS`) — saat ini masih kosong.
