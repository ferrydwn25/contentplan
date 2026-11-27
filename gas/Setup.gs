/**
 * ============================================================================
 * Setup.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan". Saya TIDAK membaca kode asli verbatim, jadi file ini
 * HARUS dibandingkan baris-per-baris dengan Setup.gs asli di editor
 * Apps Script SEBELUM ditempel. Bila ada perbedaan, KODE ASLI yang menang.
 *
 * TODO VERIFIKASI KONTRAK (penting):
 * Vercel mengirim GET ?api=bootstrap / oauth_tokens / due_posts, sedangkan
 * aksi doGet asli yang tercatat adalah get_full_vercel_bootstrap_data /
 * get_oauth_connections dst. Ringkasan browser TIDAK mencatat nama
 * parameter yang dipakai doGet asli (api? action?). Code.gs di draft ini
 * menerima KEDUA bentuk sebagai alias. JANGAN ubah kontrak Vercel tanpa
 * verifikasi terhadap doGet asli. Lihat README-DRAFT.md.
 *
 * PERUBAHAN HARDENED DIBANDING ASLI (menurut ringkasan):
 * - setupContentPlan() idempotent: tidak pernah menimpa data yang sudah
 *   ada; seed hanya berjalan bila tab masih kosong (hanya header).
 * - Seed data contoh dipertahankan seperti aslinya (brand Bacon Files,
 *   TikTok/Instagram @bacon.files, 2 konten contoh) agar perilaku sama,
 *   tetapi Ferry disarankan menghapus data contoh sebelum produksi.
 * - Tidak ada trigger yang dibuat di sini (sesuai temuan: tidak ada
 *   trigger di daftar file asli). Jangan tambah trigger diam-diam.
 * ============================================================================
 */

/* 17 tab yang dibuat setup — sesuai CONFIG asli + FEED_LAYOUT (P2). */
var SETUP_SHEET_NAMES = [
  'SETTINGS', 'ACCOUNTS', 'CONTENTS', 'CONTENT_METRICS',
  'ACCOUNT_METRICS', 'CAMPAIGNS', 'MEDIA_LIBRARY', 'IMPORT_LOG',
  'ACTIVITY_LOG', 'NOTIFICATIONS', 'SCHEDULE_SLOTS', 'BRAND_CONTEXT',
  'OAUTH_CONNECTIONS', 'UNIFIED_INBOX', 'USERS', 'SESSIONS', 'FEED_LAYOUT'
];

function setupContentPlan() {
  SETUP_SHEET_NAMES.forEach(function (name) {
    createSheetIfNotExists(name, getSheetHeaders_(name));
  });
  seedDefaultData();
  return { success: true, message: 'Setup selesai: 17 tab dipastikan ada.' };
}

function createSheetIfNotExists(name, headers) {
  return ensureSheetExists(name, headers);
}

function seedDefaultData() {
  /* Seed HANYA bila tab masih kosong — jangan timpa data Ferry. */
  var brandSheet = getSheet(SHEET_NAMES.brandContext);
  if (brandSheet && brandSheet.getLastRow() <= 1) {
    DB_insert(SHEET_NAMES.brandContext, {
      brand_id: generateUUID(),
      brand_name: 'Bacon Files',
      niche: '',
      target_audience: '',
      tone_of_voice: '',
      product_or_core_hook: '',
      updated_at: new Date().toISOString(),
      mood: '', guidelines: '', narrative_style: '',
      hook_formulas: '', learned_patterns: '', pillar_learning: ''
    });
  }

  var accountSheet = getSheet(SHEET_NAMES.accounts);
  if (accountSheet && accountSheet.getLastRow() <= 1) {
    var now = new Date().toISOString();
    DB_insert(SHEET_NAMES.accounts, {
      account_id: generateUUID(), brand_name: 'Bacon Files',
      platform: 'TikTok', account_name: 'Bacon Files',
      username: '@bacon.files', profile_url: '', niche: '',
      account_type: '', target_followers: '', current_followers: '',
      account_status: 'Active', notes: '', created_at: now, updated_at: now
    });
    DB_insert(SHEET_NAMES.accounts, {
      account_id: generateUUID(), brand_name: 'Bacon Files',
      platform: 'Instagram', account_name: 'Bacon Files',
      username: '@bacon.files', profile_url: '', niche: '',
      account_type: '', target_followers: '', current_followers: '',
      account_status: 'Active', notes: '', created_at: now, updated_at: now
    });
  }

  var contentSheet = getSheet(SHEET_NAMES.contents);
  if (contentSheet && contentSheet.getLastRow() <= 1) {
    var now2 = new Date().toISOString();
    [1, 2].forEach(function (n) {
      DB_insert(SHEET_NAMES.contents, {
        content_id: generateUUID(),
        brand_name: 'Bacon Files',
        account_id: '', platform: 'TikTok', campaign_id: '',
        content_title: 'Konten contoh ' + n,
        content_description: 'Data contoh dari setup awal — hapus sebelum produksi.',
        content_pillar: '', content_type: '', content_format: '',
        content_category: '', caption: '', hashtag: '', script: '',
        content_reference: '', production_date: '',
        scheduled_date: '', scheduled_time: '', published_date: '',
        content_status: 'Draft', priority: '', responsible_person: '',
        video_url: '', thumbnail_url: '', notes: '',
        created_at: now2, updated_at: now2
      });
    });
  }
  return { success: true };
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ContentPlan')
    .addItem('Setup awal (buat 16 tab)', 'setupContentPlan')
    .addItem('Isi data contoh (bila kosong)', 'seedDefaultData')
    .addToUi();
}
