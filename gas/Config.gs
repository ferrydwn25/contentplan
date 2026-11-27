/**
 * ============================================================================
 * Config.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan" (7 file .gs, dibaca di editor Apps Script tanpa diubah).
 * Saya TIDAK membaca kode asli verbatim, jadi file ini HARUS dibandingkan
 * baris-per-baris dengan Config.gs asli di editor Apps Script SEBELUM
 * ditempel. Bila ada perbedaan, KODE ASLI yang menang.
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
 * - SECRET_KEY TIDAK LAGI hardcode di file ini. Secret dibaca dari
 *   Script Properties (GAS_API_SECRET). Jangan tulis nilainya di sini,
 *   di Sheets, atau di repo.
 * - SPREADSHEET_ID juga tidak hardcode: dipakai spreadsheet aktif
 *   (bound script) atau Script Properties SPREADSHEET_ID bila ada.
 * - Token OAuth TIDAK disimpan di file ini / di Sheets.
 * ============================================================================
 */

var DEFAULT_TIMEZONE = 'Asia/Jakarta';
var DEFAULT_CURRENCY = 'IDR';
var GEMINI_MODEL = 'gemini-2.0-flash';

/* Batas upload media (lihat Media.gs). */
var MAX_MEDIA_BYTES = 25 * 1024 * 1024; /* 25 MB */
var ALLOWED_MEDIA_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime'
];

/* 16 nama tab — sesuai CONFIG asli (Sheet1 di spreadsheet live bukan
 * bagian dari CONFIG ini; jangan hapus Sheet1 tanpa cek Ferry). */
var SHEET_NAMES = {
  settings: 'SETTINGS',
  accounts: 'ACCOUNTS',
  contents: 'CONTENTS',
  contentMetrics: 'CONTENT_METRICS',
  accountMetrics: 'ACCOUNT_METRICS',
  campaigns: 'CAMPAIGNS',
  mediaLibrary: 'MEDIA_LIBRARY',
  importLog: 'IMPORT_LOG',
  activityLog: 'ACTIVITY_LOG',
  notifications: 'NOTIFICATIONS',
  scheduleSlots: 'SCHEDULE_SLOTS',
  brandContext: 'BRAND_CONTEXT',
  oauthConnections: 'OAUTH_CONNECTIONS',
  inbox: 'UNIFIED_INBOX',
  users: 'USERS',
  sessions: 'SESSIONS'
};

/**
 * Header tiap tab. Yang bertanda TERVERIFIKASI diambil dari pembacaan
 * langsung Sheets "Content Plan - Database". Yang bertanda TODO adalah
 * inferensi dari pemakaian di draft (bukan dari kode asli) — verifikasi
 * terhadap header asli di Sheets sebelum memakai setupContentPlan().
 */
var SHEET_HEADERS = {
  SETTINGS: ['setting_key', 'setting_value', 'description', 'updated_at'], /* TERVERIFIKASI */
  ACCOUNTS: ['account_id', 'brand_name', 'platform', 'account_name', 'username', 'profile_url', 'niche', 'account_type', 'target_followers', 'current_followers', 'account_status', 'notes', 'created_at', 'updated_at'], /* TERVERIFIKASI */
  CONTENTS: ['content_id', 'brand_name', 'account_id', 'platform', 'campaign_id', 'content_title', 'content_description', 'content_pillar', 'content_type', 'content_format', 'content_category', 'caption', 'hashtag', 'script', 'content_reference', 'production_date', 'scheduled_date', 'scheduled_time', 'published_date', 'content_status', 'priority', 'responsible_person', 'video_url', 'thumbnail_url', 'notes', 'created_at', 'updated_at'], /* TERVERIFIKASI */
  CAMPAIGNS: ['campaign_id', 'name', 'start_date', 'end_date', 'status'], /* TERVERIFIKASI */
  SCHEDULE_SLOTS: ['slot_id', 'brand_name', 'time_slot', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'is_active'], /* TERVERIFIKASI */
  BRAND_CONTEXT: ['brand_id', 'brand_name', 'niche', 'target_audience', 'tone_of_voice', 'product_or_core_hook', 'updated_at', 'mood', 'guidelines', 'narrative_style', 'hook_formulas', 'learned_patterns', 'pillar_learning'], /* TERVERIFIKASI */
  /* OAUTH_CONNECTIONS: header dipertahankan agar kompatibel dengan sheet
   * lama, tetapi kolom access_token / refresh_token SENGAJA TIDAK PERNAH
   * diisi oleh draft ini. Token hanya di Script Properties. */
  OAUTH_CONNECTIONS: ['conn_id', 'brand_name', 'platform', 'platform_user_id', 'username', 'access_token', 'refresh_token', 'expires_at', 'status', 'connected_at'], /* TERVERIFIKASI */
  CONTENT_METRICS: ['content_id', 'brand_name', 'platform', 'views', 'likes', 'comments', 'shares', 'engagement_rate', 'recorded_at'], /* TODO VERIFIKASI */
  ACCOUNT_METRICS: ['account_id', 'brand_name', 'platform', 'followers', 'views', 'recorded_at'], /* TODO VERIFIKASI */
  MEDIA_LIBRARY: ['file_id', 'file_name', 'mime_type', 'file_url', 'brand_name', 'uploaded_at'], /* TODO VERIFIKASI */
  IMPORT_LOG: ['imported_at', 'source', 'rows_imported', 'status', 'notes'], /* TODO VERIFIKASI */
  ACTIVITY_LOG: ['timestamp', 'action', 'detail', 'actor'], /* TODO VERIFIKASI */
  NOTIFICATIONS: ['notification_id', 'brand_name', 'message', 'is_read', 'created_at'], /* TODO VERIFIKASI */
  UNIFIED_INBOX: ['msg_id', 'brand_name', 'platform', 'post_id', 'post_title', 'sender_username', 'comment_text', 'received_at', 'status', 'reply_text'], /* TODO VERIFIKASI */
  USERS: ['user_id', 'username', 'password_hash', 'salt', 'role', 'is_active', 'created_at', 'updated_at'],
  SESSIONS: ['session_id', 'user_id', 'username', 'expires_at', 'created_at']
};

/* ------------------------- konfigurasi & secret ------------------------- */

function getConfig() {
  return {
    spreadsheetId: getSpreadsheetId_(),
    timezone: DEFAULT_TIMEZONE,
    currency: DEFAULT_CURRENCY,
    geminiModel: GEMINI_MODEL,
    sheets: SHEET_NAMES
  };
}

function getSpreadsheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
  if (id) return id;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss ? ss.getId() : '';
}

/* Secret HANYA dari Script Properties. Jangan hardcode nilainya. */
function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty('GAS_API_SECRET') || '';
}

function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

/* Perbandingan secret yang tidak bocor lewat timing (best-effort di GAS). */
function secretsEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validateSecret(secret) {
  return secretsEqual_(String(secret || ''), getSecret_());
}

/* ------------------------------ akses sheet ----------------------------- */

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  return ss.getSheetByName(name);
}

function getSheetByName(name) {
  return getSheet(name);
}

function getSheetHeaders_(name) {
  return SHEET_HEADERS[name] || [];
}

/* Buat tab bila belum ada; tulis header hanya bila tab masih kosong. */
function ensureSheetExists(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var hdrs = headers || getSheetHeaders_(name);
  if (hdrs.length > 0 && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, hdrs.length).setValues([hdrs]);
    sh.setFrozenRows(1);
  }
  return sh;
}
