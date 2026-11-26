/**
 * ============================================================================
 * Database.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan". Saya TIDAK membaca kode asli verbatim, jadi file ini
 * HARUS dibandingkan baris-per-baris dengan Database.gs asli di editor
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
 * - generateUUID() memakai Utilities.getUuid(), bukan Math.random().
 * - logActivity(): bila Session.getActiveUser().getEmail() kosong (umum
 *   pada Web App yang dijalankan sebagai Me), dicatat 'system', bukan
 *   string kosong — dan kegagalan logging tidak menggagalkan aksi utama.
 * - Semua tulis memakai LockService agar dua request bersamaan tidak
 *   merusak baris yang sama.
 * ============================================================================
 */

/* --------------------------- konversi baris <-> objek -------------------- */

function _arrToObj(headers, row) {
  var obj = {};
  headers.forEach(function (h, i) {
    if (h) obj[h] = row[i];
  });
  return obj;
}

function _objToArr(headers, obj) {
  return headers.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  });
}

function _readSheet_(sheetName) {
  var sh = getSheet(sheetName);
  if (!sh) return { sheet: null, headers: [], rows: [] };
  var values = sh.getDataRange().getValues();
  if (values.length === 0) return { sheet: sh, headers: [], rows: [] };
  return {
    sheet: sh,
    headers: values[0].map(function (h) { return String(h).trim(); }),
    rows: values.slice(1)
  };
}

function _nonEmptyRow_(row) {
  return row.some(function (c) { return c !== '' && c !== null && c !== undefined; });
}

/* --------------------------------- baca --------------------------------- */

function DB_getAll(sheetName) {
  var data = _readSheet_(sheetName);
  if (!data.sheet || data.headers.length === 0) return [];
  return data.rows.filter(_nonEmptyRow_).map(function (r) {
    return _arrToObj(data.headers, r);
  });
}

/* Alias baca yang dipakai VercelBridge / Code router. */
function DB_read(sheetName) {
  return DB_getAll(sheetName);
}

function DB_getById(sheetName, idValue, idField) {
  var field = idField || 'content_id';
  var all = DB_getAll(sheetName);
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][field]) === String(idValue)) return all[i];
  }
  return null;
}

/* --------------------------------- tulis -------------------------------- */

function DB_insert(sheetName, obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = _readSheet_(sheetName);
    if (!data.sheet) return { success: false, error: 'Tab ' + sheetName + ' tidak ditemukan.' };
    var headers = data.headers.length > 0 ? data.headers : getSheetHeaders_(sheetName);
    if (headers.length === 0) return { success: false, error: 'Header tab ' + sheetName + ' tidak diketahui.' };
    if (data.headers.length === 0) {
      data.sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    data.sheet.appendRow(_objToArr(headers, obj));
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function DB_update(sheetName, idValue, idField, updates) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = _readSheet_(sheetName);
    if (!data.sheet) return { success: false, error: 'Tab ' + sheetName + ' tidak ditemukan.' };
    var idIdx = data.headers.indexOf(idField || 'content_id');
    if (idIdx < 0) return { success: false, error: 'Kolom id tidak ditemukan di ' + sheetName + '.' };
    for (var r = 0; r < data.rows.length; r++) {
      if (String(data.rows[r][idIdx]) === String(idValue)) {
        var current = _arrToObj(data.headers, data.rows[r]);
        Object.keys(updates || {}).forEach(function (k) { current[k] = updates[k]; });
        data.sheet.getRange(r + 2, 1, 1, data.headers.length)
          .setValues([_objToArr(data.headers, current)]);
        return { success: true };
      }
    }
    return { success: false, error: 'Baris tidak ditemukan.' };
  } finally {
    lock.releaseLock();
  }
}

function DB_delete(sheetName, idValue, idField) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = _readSheet_(sheetName);
    if (!data.sheet) return { success: false, error: 'Tab ' + sheetName + ' tidak ditemukan.' };
    var idIdx = data.headers.indexOf(idField || 'content_id');
    if (idIdx < 0) return { success: false, error: 'Kolom id tidak ditemukan di ' + sheetName + '.' };
    for (var r = 0; r < data.rows.length; r++) {
      if (String(data.rows[r][idIdx]) === String(idValue)) {
        data.sheet.deleteRow(r + 2);
        return { success: true };
      }
    }
    return { success: false, error: 'Baris tidak ditemukan.' };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------ util umum ------------------------------- */

/* HARDENED: UUID dari platform, bukan Math.random(). */
function generateUUID() {
  return Utilities.getUuid();
}

function logActivity(action, detail) {
  try {
    var actor = 'system';
    try {
      var email = Session.getActiveUser().getEmail();
      if (email) actor = email;
    } catch (e) {
      /* Web App "Execute as Me": email pemanggil sering kosong.
       * Itu kondisi normal, bukan error — dicatat sebagai 'system'. */
      actor = 'system';
    }
    var sh = getSheet(SHEET_NAMES.activityLog);
    if (!sh) return;
    sh.appendRow([new Date().toISOString(), action, detail || '', actor]);
  } catch (e) {
    /* Logging tidak boleh menggagalkan aksi utama. */
    console.error('logActivity gagal: ' + e.message);
  }
}
