/**
 * ============================================================================
 * VercelBridge.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan". Saya TIDAK membaca kode asli verbatim, jadi file ini
 * HARUS dibandingkan baris-per-baris dengan VercelBridge.gs asli di
 * editor Apps Script SEBELUM ditempel. Bila ada perbedaan, KODE ASLI
 * yang menang.
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
 * - CRUD (handleGetData / handleCreateData / handleUpdateData /
 *   handleDeleteData) HANYA ADA DI SINI — satu implementasi. Di kode
 *   asli logika yang sama juga ada di Code.gs (duplikasi); Code.gs di
 *   draft ini memanggil fungsi di file ini, bukan menduplikasinya.
 * - getFullVercelBootstrapData() TIDAK mengembalikan token: koneksi
 *   OAuth hanya metadata. Token hanya lewat endpoint server-ke-server
 *   oauth_tokens (lihat Code.gs) dan tetap butuh secret yang valid.
 * - getStats() hanya memakai angka nyata dari tab metrik. Tidak ada
 *   skor retensi buatan.
 * ============================================================================
 */

/* Tab yang boleh dibaca/ditulis lewat CRUD generik. */
var CRUD_SHEETS = [
  'SETTINGS', 'ACCOUNTS', 'CONTENTS', 'CONTENT_METRICS',
  'ACCOUNT_METRICS', 'CAMPAIGNS', 'MEDIA_LIBRARY', 'IMPORT_LOG',
  'ACTIVITY_LOG', 'NOTIFICATIONS', 'SCHEDULE_SLOTS', 'BRAND_CONTEXT',
  'OAUTH_CONNECTIONS', 'UNIFIED_INBOX'
];

function _idFieldFor_(sheetName) {
  var map = {
    CONTENTS: 'content_id',
    ACCOUNTS: 'account_id',
    CAMPAIGNS: 'campaign_id',
    BRAND_CONTEXT: 'brand_id',
    OAUTH_CONNECTIONS: 'conn_id',
    SCHEDULE_SLOTS: 'slot_id',
    MEDIA_LIBRARY: 'file_id',
    NOTIFICATIONS: 'notification_id',
    UNIFIED_INBOX: 'msg_id'
  };
  return map[sheetName] || 'content_id';
}

function getFullVercelBootstrapData() {
  return {
    success: true,
    settings: DB_getAll(SHEET_NAMES.settings),
    accounts: DB_getAll(SHEET_NAMES.accounts),
    contents: DB_getAll(SHEET_NAMES.contents),
    campaigns: DB_getAll(SHEET_NAMES.campaigns),
    media: DB_getAll(SHEET_NAMES.mediaLibrary),
    metrics: DB_getAll(SHEET_NAMES.contentMetrics),
    accountMetrics: DB_getAll(SHEET_NAMES.accountMetrics),
    notifications: DB_getAll(SHEET_NAMES.notifications),
    scheduleSlots: DB_getAll(SHEET_NAMES.scheduleSlots),
    brandContext: DB_getAll(SHEET_NAMES.brandContext),
    oauthConnections: getOAuthConnections(),
    unifiedInbox: DB_getAll(SHEET_NAMES.inbox)
    /* SENGAJA tanpa token. Frontend tidak butuh token. */
  };
}

function getDashboardData(brandName) {
  var contents = DB_getAll(SHEET_NAMES.contents);
  var rows = brandName
    ? contents.filter(function (c) { return String(c.brand_name) === String(brandName); })
    : contents;
  var byStatus = {};
  rows.forEach(function (c) {
    var s = String(c.content_status || 'Draft');
    byStatus[s] = (byStatus[s] || 0) + 1;
  });
  return {
    success: true,
    brand_name: brandName || 'ALL',
    totalContents: rows.length,
    byStatus: byStatus,
    upcoming: rows.filter(function (c) { return String(c.content_status) === 'Ready'; }).slice(0, 10)
  };
}

function getStats(brandName) {
  /* Angka nyata saja — dari tab metrik. Tanpa retensi buatan. */
  var accountMetrics = DB_getAll(SHEET_NAMES.accountMetrics);
  var contentMetrics = DB_getAll(SHEET_NAMES.contentMetrics);
  var am = brandName
    ? accountMetrics.filter(function (m) { return String(m.brand_name) === String(brandName); })
    : accountMetrics;
  var cm = brandName
    ? contentMetrics.filter(function (m) { return String(m.brand_name) === String(brandName); })
    : contentMetrics;
  var followers = 0, views = 0;
  am.forEach(function (m) { followers += Number(m.followers || 0); views += Number(m.views || 0); });
  var contentViews = 0, likes = 0, comments = 0, shares = 0;
  cm.forEach(function (m) {
    contentViews += Number(m.views || 0);
    likes += Number(m.likes || 0);
    comments += Number(m.comments || 0);
    shares += Number(m.shares || 0);
  });
  var engagement = likes + comments + shares;
  return {
    success: true,
    brand_name: brandName || 'ALL',
    totalFollowers: followers,
    totalViews: contentViews || views,
    totalLikes: likes,
    totalComments: comments,
    totalShares: shares,
    engagementRate: contentViews > 0 ? ((engagement / contentViews) * 100).toFixed(2) : '0.00'
  };
}

/* --------------------- CRUD generik (satu implementasi) ------------------ */

function handleGetData(sheetName, idValue) {
  if (CRUD_SHEETS.indexOf(sheetName) === -1) {
    return { success: false, error: 'Tab tidak diizinkan: ' + sheetName + '.' };
  }
  if (sheetName === 'OAUTH_CONNECTIONS') {
    /* Jangan pernah kembalikan token lewat jalur baca generik. */
    return { success: true, data: getOAuthConnections() };
  }
  if (idValue) {
    var one = DB_getById(sheetName, idValue, _idFieldFor_(sheetName));
    if (!one) return { success: false, error: 'Baris tidak ditemukan.' };
    return { success: true, data: one };
  }
  return { success: true, data: DB_getAll(sheetName) };
}

function handleCreateData(sheetName, payload) {
  if (CRUD_SHEETS.indexOf(sheetName) === -1) {
    return { success: false, error: 'Tab tidak diizinkan: ' + sheetName + '.' };
  }
  if (sheetName === 'OAUTH_CONNECTIONS') {
    return { success: false, error: 'Koneksi OAuth hanya lewat save_oauth_connection.' };
  }
  var record = payload || {};
  var idField = _idFieldFor_(sheetName);
  if (!record[idField]) record[idField] = generateUUID();
  if (getSheetHeaders_(sheetName).indexOf('created_at') !== -1) record.created_at = new Date().toISOString();
  record.updated_at = new Date().toISOString();
  var res = DB_insert(sheetName, record);
  if (!res.success) return res;
  logActivity('create:' + sheetName, String(record[idField]));
  return { success: true, data: record };
}

function handleUpdateData(sheetName, idValue, payload) {
  if (CRUD_SHEETS.indexOf(sheetName) === -1) {
    return { success: false, error: 'Tab tidak diizinkan: ' + sheetName + '.' };
  }
  if (sheetName === 'OAUTH_CONNECTIONS') {
    return { success: false, error: 'Koneksi OAuth hanya lewat save_oauth_connection.' };
  }
  var updates = payload || {};
  updates.updated_at = new Date().toISOString();
  var res = DB_update(sheetName, idValue, _idFieldFor_(sheetName), updates);
  if (!res.success) return res;
  logActivity('update:' + sheetName, String(idValue));
  return { success: true };
}

function handleDeleteData(sheetName, idValue) {
  if (CRUD_SHEETS.indexOf(sheetName) === -1) {
    return { success: false, error: 'Tab tidak diizinkan: ' + sheetName + '.' };
  }
  if (sheetName === 'OAUTH_CONNECTIONS') {
    return { success: false, error: 'Koneksi OAuth hanya lewat delete_oauth_connection.' };
  }
  var res = DB_delete(sheetName, idValue, _idFieldFor_(sheetName));
  if (!res.success) return res;
  logActivity('delete:' + sheetName, String(idValue));
  return { success: true };
}

/* ------------------------- cron: konten jatuh tempo ---------------------- */

function duePosts_(dateStr, hourPrefix) {
  var due = DB_getAll(SHEET_NAMES.contents).filter(function (c) {
    var d = String(c.scheduled_date || '').slice(0, 10);
    var h = String(c.scheduled_time || '').slice(0, 2);
    return d === dateStr && h === String(hourPrefix).padStart(2, '0')
      && String(c.content_status || '') === 'Ready';
  });
  return { success: true, duePosts: due };
}

/* Tandai Published HANYA setelah publikasi nyata berhasil (dipanggil cron).
 * Baris yang statusnya bukan 'Ready' tidak diubah. */
function markPublishedByCron(publishedIds) {
  if (!Array.isArray(publishedIds) || publishedIds.length === 0) {
    return { success: true, updated: 0 };
  }
  var updated = 0;
  publishedIds.forEach(function (id) {
    var c = DB_getById(SHEET_NAMES.contents, id, 'content_id');
    if (c && String(c.content_status) === 'Ready') {
      var res = DB_update(SHEET_NAMES.contents, id, 'content_id', {
        content_status: 'Published',
        published_date: new Date().toISOString()
      });
      if (res.success) updated++;
    }
  });
  logActivity('mark_published_by_cron', 'updated=' + updated);
  return { success: true, updated: updated };
}

/* ------------------------------ slot posting ----------------------------- */

function addSlot(brandName, timeSlot) {
  if (!brandName || !timeSlot) return { success: false, error: 'brandName dan timeSlot wajib diisi.' };
  var res = DB_insert(SHEET_NAMES.scheduleSlots, {
    slot_id: generateUUID(), brand_name: brandName, time_slot: timeSlot,
    mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true,
    is_active: true
  });
  return res.success ? { success: true } : res;
}

function toggleSlot(slotId, dayKey, value) {
  if (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(dayKey) === -1) {
    return { success: false, error: 'dayKey tidak valid.' };
  }
  var updates = {};
  updates[dayKey] = !!value;
  var res = DB_update(SHEET_NAMES.scheduleSlots, slotId, 'slot_id', updates);
  return res.success ? { success: true } : res;
}

function deleteSlot(slotId) {
  var res = DB_delete(SHEET_NAMES.scheduleSlots, slotId, 'slot_id');
  return res.success ? { success: true } : res;
}
