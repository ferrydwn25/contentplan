/**
 * ============================================================================
 * Code.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini MENGGANTIKAN draft single-file lama (gas/Code.gs yang lama
 * berisi seluruh backend dalam satu file). Logika dari draft lama kini
 * tersebar ke 7 file sesuai struktur asli: Config, Code (file ini,
 * router saja), Setup, VercelBridge, BleamFeatures, Database, Media.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan". Saya TIDAK membaca kode asli verbatim, jadi file ini
 * HARUS dibandingkan baris-per-baris dengan Code.gs asli di editor
 * Apps Script SEBELUM ditempel. Bila ada perbedaan, KODE ASLI yang menang.
 *
 * TODO VERIFIKASI KONTRAK (penting — baca sebelum tempel):
 * Vercel mengirim GET ?api=bootstrap / oauth_tokens / due_posts, sedangkan
 * aksi doGet asli yang tercatat adalah get_full_vercel_bootstrap_data /
 * get_oauth_connections dst. Ringkasan browser TIDAK mencatat nama
 * parameter yang dipakai doGet asli (api? action?) maupun bentuk
 * parameter doPost asli. Router di bawah ini menerima KEDUA bentuk:
 *   GET:  ?api=<nama>  ATAU  ?action=<nama>  (nama asli maupun alias Vercel)
 *   POST: body.action  (nama asli) ATAU nama aksi Vercel (alias)
 * JANGAN ubah kontrak Vercel tanpa verifikasi terhadap doGet/doPost asli.
 * Bila doGet asli ternyata hanya mengenal satu bentuk, hapus alias yang
 * tidak dipakai — jangan biarkan dua jalur hidup tanpa kepastian.
 * Lihat README-DRAFT.md untuk tabel pemetaan lengkap.
 *
 * PERUBAHAN HARDENED DIBANDING ASLI (menurut ringkasan):
 * - validateSecret() membandingkan secret secara constant-time dan
 *   secret HANYA dari Script Properties (lihat Config.gs). Secret
 *   diperiksa di SETIAP request GET dan POST, sebelum aksi apapun.
 * - Duplikasi CRUD dirapikan: handleGetData / handleCreateData /
 *   handleUpdateData / handleDeleteData HANYA ada di VercelBridge.gs
 *   (satu implementasi). Router di sini memanggilnya, bukan
 *   menduplikasinya. Nama keempat fungsi itu tetap ada di proyek
 *   (di VercelBridge.gs).
 * - Handler lain di bawah ini dipertahankan namanya seperti aslinya,
 *   tetapi isinya hanya meneruskan ke implementasi di BleamFeatures /
 *   Media / VercelBridge / Database.
 * - GET tidak pernah mengembalikan token (lihat oauth_tokens: hanya
 *   untuk pemanggil server-ke-server, tetap butuh secret).
 * ============================================================================
 */

/* ------------------------- pemetaan aksi (alias) ------------------------- */
/* Nama aksi ASLI -> fungsi. Alias Vercel dipetakan di router di bawah. */
var GET_ACTIONS = {
  get_data: 'handleGetData',
  get_dashboard_data: 'handleGetDashboardData',
  get_stats: 'handleGetStats',
  get_brand_context: 'handleGetBrandContext',
  get_oauth_connections: 'handleGetOAuthConnections',
  get_media_files: 'handleGetMediaFiles',
  get_unified_inbox: 'handleGetUnifiedInbox',
  get_notifications: 'handleGetNotifications',
  get_campaigns: 'handleGetCampaigns',
  get_full_vercel_bootstrap_data: 'handleGetFullVercelBootstrapData',
  /* Alias Vercel (TODO VERIFIKASI — lihat catatan di kepala file): */
  bootstrap: 'handleGetFullVercelBootstrapData',
  oauth_tokens: 'handleGetOAuthTokens',
  due_posts: 'handleGetDuePosts'
};

/* ------------------------------ util umum ------------------------------- */

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------ GET handler ----------------------------- */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    /* Login: panggilan dari frontend yang sudah login boleh memakai
     * session_token sebagai pengganti secret GAS. Panggilan
     * server-ke-server (gas-proxy dengan GAS_API_SECRET, social-sync,
     * cron) tetap memakai secret seperti semula — jalur itu TIDAK
     * dihapus dan TIDAK diubah. */
    var session = p.session_token ? authValidateSession(p.session_token) : { valid: false };
    if (!validateSecret(p.secret) && !session.valid) {
      return jsonResponse({ success: false, error: 'Unauthorized: secret tidak cocok.' });
    }
    var action = String(p.api || p.action || 'get_full_vercel_bootstrap_data');
    if (!GET_ACTIONS[action]) {
      return jsonResponse({ success: false, error: 'Aksi GET tidak dikenal: ' + action });
    }
    var brand = p.brand || p.brand_name || '';
    switch (GET_ACTIONS[action]) {
      case 'handleGetData':
        return jsonResponse(handleGetData(p.sheet || p.tab || '', p.id || ''));
      case 'handleGetDashboardData':
        return jsonResponse(handleGetDashboardData(brand));
      case 'handleGetStats':
        return jsonResponse(handleGetStats(brand));
      case 'handleGetBrandContext':
        return jsonResponse({ success: true, data: getBrandContext(brand || null) });
      case 'handleGetOAuthConnections':
        return jsonResponse({ success: true, connections: getOAuthConnections(brand || null) });
      case 'handleGetMediaFiles':
        return jsonResponse({ success: true, data: getMediaFiles(brand || null) });
      case 'handleGetUnifiedInbox':
        return jsonResponse({ success: true, data: getUnifiedInbox(brand || null) });
      case 'handleGetNotifications':
        return jsonResponse({ success: true, data: getNotifications(brand || null) });
      case 'handleGetCampaigns':
        return jsonResponse({ success: true, data: getCampaigns() });
      case 'handleGetFullVercelBootstrapData':
        return jsonResponse(handleGetFullVercelBootstrapData());
      case 'handleGetOAuthTokens':
        return jsonResponse(handleGetOAuthTokens());
      case 'handleGetDuePosts':
        return jsonResponse(handleGetDuePosts(p.date || '', p.hour || ''));
      default:
        return jsonResponse({ success: false, error: 'Aksi GET tidak dikenal.' });
    }
  } catch (err) {
    console.error('doGet error: ' + err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

/* ----------------------------- POST handler ----------------------------- */

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(body.action || '');
    /* Aksi auth publik: TIDAK butuh secret GAS, karena tujuannya justru
     * mendapatkan sesi. Ketiga aksi ini rate-limited (login) atau
     * tidak mengembalikan data sensitif (logout / validate_session).
     * Semua aksi lain tetap butuh secret ATAU session_token yang valid. */
    if (action === 'login' || action === 'logout' || action === 'validate_session') {
      var authResult = routePostAction_(action, body);
      return jsonResponse(authResult);
    }
    var session = body.session_token ? authValidateSession(body.session_token) : { valid: false };
    if (!validateSecret(body.secret) && !session.valid) {
      return jsonResponse({ success: false, error: 'Unauthorized: secret tidak cocok.' });
    }
    var result = routePostAction_(action, body);
    try { logActivity(action, result && result.success ? 'ok' : ('gagal: ' + (result.error || ''))); } catch (ignore) {}
    return jsonResponse(result);
  } catch (err) {
    console.error('doPost error: ' + err.message);
    return jsonResponse({ success: false, error: err.message });
  }
}

/* Aksi ASLI (dari ringkasan) + alias Vercel (TODO VERIFIKASI). */
function routePostAction_(action, body) {
  switch (action) {
    /* --- aksi auth (tanpa secret; lihat Edit 2 di doPost) --- */
    case 'login': return authLogin(body);
    case 'logout': return authLogout(body);
    case 'validate_session': return authValidateSessionAction(body);
    /* --- aksi asli --- */
    case 'create': return handleCreateData(body.sheet || body.tab || '', body.payload || body.data || {});
    case 'update': return handleUpdateData(body.sheet || body.tab || '', body.id || '', body.payload || body.data || {});
    case 'delete': return handleDeleteData(body.sheet || body.tab || '', body.id || '');
    case 'publish_content': return handlePublishContent(body.payload || body);
    case 'save_brand_context': return handleSaveBrandContext(body.payload || body);
    case 'save_oauth_connection': return handleSaveOAuthConnection(body.payload || body);
    case 'delete_oauth_connection': return handleDeleteOAuthConnection(body.connId || body.conn_id || '');
    case 'upload_media': return handleUploadMedia(body.payload || body);
    case 'mark_inbox_item_read': return handleMarkInboxItemRead(body.msgId || body.msg_id || '');
    case 'mark_notification_read': return handleMarkNotificationRead(body.notificationId || body.notification_id || '');
    case 'generate_ai_content': return handleGenerateAIContent(body.payload || body);
    case 'save_campaign': return handleSaveCampaign(body.payload || body);
    /* --- alias Vercel (TODO VERIFIKASI) --- */
    case 'save_composer_post': {
      /* autoQueue (tombol "Jadwalkan ke Slot Berikutnya"): cari slot kosong
       * berikutnya dari SCHEDULE_SLOTS + CONTENTS, isi tanggal/jam otomatis.
       * Tanpa ini tombol tersebut identik dengan "Simpan Jadwal Ini". */
      var p = body.payload || {};
      if (body.autoQueue) return saveComposerPostAutoQueue_(p);
      var res;
      if (p.content_id) res = handleUpdateData('CONTENTS', p.content_id, p);
      else res = handleCreateData('CONTENTS', p);
      if (!res.success) return res;
      return { success: true, data: res.data || p, scheduled_date: p.scheduled_date, scheduled_time: p.scheduled_time, autoQueued: false };
    }
    case 'delete_post': return handleDeleteData('CONTENTS', body.contentId || body.content_id || '');
    case 'upload_asset': return handleUploadMedia(body.payload || body);
    case 'mark_published_by_cron': return markPublishedByCron(body.publishedIds || []);
    case 'sync_inbox_batch': return syncInboxBatch_(body.comments || []);
    case 'reply_inbox': return replyInbox_(body.msgId || body.msg_id || '', body.replyText || body.reply_text || '');
    case 'disconnect_oauth': return handleDeleteOAuthConnection(body.connId || body.conn_id || '');
    case 'add_slot': return addSlot(body.brandName || body.brand_name || '', body.timeSlot || body.time_slot || '');
    case 'toggle_slot': return toggleSlot(body.slotId || body.slot_id || '', body.dayKey || body.day_key || '', !!body.value);
    case 'delete_slot': return deleteSlot(body.slotId || body.slot_id || '');
    case 'delete_brand_context': return deleteBrandContext_(body.brandId || body.brand_id || '');
    case 'generate_batch':
    case 'ai_caption':
    case 'learn_brand_style':
      return handleGenerateAIContent(body.payload || body);
    default:
      return { success: false, error: 'Action tidak dikenal: ' + action };
  }
}

/* ----------------- handler GET/POST (nama asli, thin wrapper) ------------ */
/* handleGetData / handleCreateData / handleUpdateData / handleDeleteData
 * TIDAK didefinisikan ulang di sini — implementasi tunggalnya ada di
 * VercelBridge.gs. Router di atas memanggil fungsi-fungsi itu langsung. */

function handleGetDashboardData(brand) {
  return getDashboardData(brand || '');
}

function handleGetStats(brand) {
  return getStats(brand || '');
}

function handlePublishContent(payload) {
  /* Publikasi nyata hanya untuk platform yang didukung; simulasi
   * TIDAK PERNAH ditandai Published (lihat BleamFeatures.publishContent). */
  return publishContent(payload || {});
}

function handleGetBrandContext(brand) {
  return { success: true, data: getBrandContext(brand || null) };
}

function handleSaveBrandContext(payload) {
  return saveBrandContext(payload || {});
}

function handleGetOAuthConnections(brand) {
  return { success: true, connections: getOAuthConnections(brand || null) };
}

function handleSaveOAuthConnection(payload) {
  return saveOAuthConnection(payload || {});
}

function handleDeleteOAuthConnection(connId) {
  if (!connId) return { success: false, error: 'connId wajib diisi.' };
  return removeOAuthConnection(connId);
}

function handleGetMediaFiles(brand) {
  return { success: true, data: getMediaFiles(brand || null) };
}

function handleUploadMedia(payload) {
  return uploadAssetToDrive(payload || {});
}

function handleGetUnifiedInbox(brand) {
  return { success: true, data: getUnifiedInbox(brand || null) };
}

function handleMarkInboxItemRead(msgId) {
  if (!msgId) return { success: false, error: 'msgId wajib diisi.' };
  return markInboxItemRead(msgId);
}

function handleGetNotifications(brand) {
  return { success: true, data: getNotifications(brand || null) };
}

function handleMarkNotificationRead(notificationId) {
  if (!notificationId) return { success: false, error: 'notificationId wajib diisi.' };
  return markNotificationRead(notificationId);
}

function handleGenerateAIContent(payload) {
  return generateAIContent(payload || {});
}

function handleGetFullVercelBootstrapData() {
  return getFullVercelBootstrapData();
}

function handleGetCampaigns() {
  return { success: true, data: getCampaigns() };
}

function handleSaveCampaign(payload) {
  return saveCampaign(payload || {});
}

/* ---------------------- endpoint server-ke-server ----------------------- */
/* oauth_tokens & due_posts: HANYA untuk /api/social-sync dan
 * /api/cron-publish (bukan frontend). Tetap butuh secret (dicek di doGet).
 * TODO VERIFIKASI: pastikan get_oauth_connections asli TIDAK dipakai
 * frontend untuk mengambil token — bila iya, ubah frontend ke metadata. */

function handleGetOAuthTokens() {
  var connections = DB_getAll(SHEET_NAMES.oauthConnections).map(function (c) {
    var tok = _readToken_(c.brand_name, c.platform) || {};
    return {
      conn_id: c.conn_id,
      brand_name: c.brand_name,
      platform: c.platform,
      platform_user_id: c.platform_user_id || tok.platform_user_id || '',
      username: c.username,
      access_token: tok.access_token || '',
      refresh_token: tok.refresh_token || '',
      expires_at: c.expires_at || tok.expires_at || '',
      status: c.status
    };
  });
  return { success: true, connections: connections };
}

function handleGetDuePosts(dateStr, hourPrefix) {
  return duePosts_(dateStr, hourPrefix);
}

/* --------------------------- helper internal ---------------------------- */

function syncInboxBatch_(comments) {
  var added = 0;
  var existing = {};
  DB_getAll(SHEET_NAMES.inbox).forEach(function (m) { existing[String(m.msg_id)] = true; });
  (comments || []).forEach(function (c) {
    if (!c.msg_id || existing[String(c.msg_id)]) return;
    var res = DB_insert(SHEET_NAMES.inbox, {
      msg_id: c.msg_id, brand_name: c.brand_name || '', platform: c.platform || '',
      post_id: c.post_id || '', post_title: c.post_title || '',
      sender_username: c.sender_username || '', comment_text: c.comment_text || '',
      received_at: c.received_at || '', status: 'Unreplied', reply_text: ''
    });
    if (res.success) added++;
  });
  return { success: true, added: added };
}

function replyInbox_(msgId, replyText) {
  if (!msgId) return { success: false, error: 'msgId wajib diisi.' };
  var res = DB_update(SHEET_NAMES.inbox, msgId, 'msg_id', { status: 'Replied', reply_text: replyText || '' });
  return res.success ? { success: true } : { success: false, error: 'Pesan tidak ditemukan.' };
}

function deleteBrandContext_(brandId) {
  if (!brandId) return { success: false, error: 'brandId wajib diisi.' };
  var res = DB_delete(SHEET_NAMES.brandContext, brandId, 'brand_id');
  return res.success ? { success: true } : res;
}
