/**
 * ============================================================================
 * BleamFeatures.gs — DRAFT (bukan kode Apps Script asli Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY.
 *
 * File ini disusun HANYA dari ringkasan browser atas proyek Apps Script
 * asli "Contentplan". Saya TIDAK membaca kode asli verbatim, jadi file ini
 * HARUS dibandingkan baris-per-baris dengan BleamFeatures.gs asli di
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
 * - generateContentSuggestions() DIDEFINISIKAN SATU KALI SAJA. Di kode
 *   asli fungsinya ada dua kali — di draft ini definisi kedua dihapus.
 * - publishContent(): platform yang hanya "simulasi" di asli TIDAK
 *   PERNAH ditandai Published dan TIDAK PERNAH mengembalikan
 *   published_url. Hasilnya { success: false, simulated: true, ... }
 *   dengan pesan jelas. Hanya Meta & TikTok yang mencoba publikasi
 *   nyata (dan hanya bila token tersedia); bila API platform gagal,
 *   konten tetap berstatus semula.
 * - Token OAuth: saveOAuthConnection() menyimpan token di Script
 *   Properties (kunci oauth_<brand>_<platform>), Sheets hanya metadata
 *   tanpa token. getOAuthConnections() tidak mengembalikan token.
 * - refreshOAuthToken(): Meta / TikTok / Google diimplementasikan
 *   dengan client secret dari Script Properties. LinkedIn / X TIDAK
 *   dibuat-buat: mengembalikan error 'belum diverifikasi' sampai
 *   endpoint & kredensialnya dicek terhadap kode asli.
 * - generateAIContent(): kunci Gemini HANYA dari Script Properties
 *   (GEMINI_API_KEY). Bila kunci tidak ada / panggilan gagal, dipakai
 *   template lokal dan hasilnya DILABELI source: 'template', bukan
 *   berpura-pura sebagai hasil AI.
 * - analyzeContentPerformance(): hanya memakai metrik nyata dari
 *   CONTENT_METRICS. Tidak ada skor retensi buatan di sini.
 * ============================================================================
 */

var MAX_POSTS_PER_DAY = 3;

/* ------------------------- penyimpanan token ---------------------------- */

function _tokenKey_(brand, platform) {
  return 'oauth_' + String(brand).toLowerCase().replace(/\s+/g, '_')
    + '_' + String(platform).toLowerCase();
}

function _storeToken_(conn) {
  PropertiesService.getScriptProperties().setProperty(_tokenKey_(conn.brand_name, conn.platform), JSON.stringify({
    access_token: conn.access_token || '',
    refresh_token: conn.refresh_token || '',
    platform_user_id: conn.platform_user_id || '',
    expires_at: conn.expires_at || ''
  }));
}

function _readToken_(brand, platform) {
  var raw = PropertiesService.getScriptProperties().getProperty(_tokenKey_(brand, platform));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function _deleteToken_(brand, platform) {
  PropertiesService.getScriptProperties().deleteProperty(_tokenKey_(brand, platform));
}

function _metaOnly_(conn) {
  return {
    conn_id: conn.conn_id,
    brand_name: conn.brand_name,
    platform: conn.platform,
    platform_user_id: conn.platform_user_id,
    username: conn.username,
    expires_at: conn.expires_at,
    status: conn.status,
    connected_at: conn.connected_at
    /* SENGAJA tanpa access_token / refresh_token. */
  };
}

/* --------------------------- brand context ------------------------------ */

function getBrandContext(brandName) {
  var all = DB_getAll(SHEET_NAMES.brandContext);
  if (brandName) {
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].brand_name) === String(brandName)) return all[i];
    }
    return null;
  }
  return all;
}

function saveBrandContext(payload) {
  if (!payload || !payload.brand_name) {
    return { success: false, error: 'brand_name wajib diisi.' };
  }
  var existing = getBrandContext(payload.brand_name);
  var now = new Date().toISOString();
  var record = existing || {};
  Object.keys(payload).forEach(function (k) { record[k] = payload[k]; });
  record.updated_at = now;
  if (!record.brand_id) record.brand_id = generateUUID();
  var res = existing
    ? DB_update(SHEET_NAMES.brandContext, record.brand_id, 'brand_id', record)
    : DB_insert(SHEET_NAMES.brandContext, record);
  if (!res.success) return res;
  logActivity('save_brand_context', 'Brand: ' + payload.brand_name);
  return { success: true, brand_id: record.brand_id };
}

function learnBrandStyle(brandName) {
  /* TODO VERIFIKASI: logika pembelajaran asli tidak tercatat di ringkasan
   * browser (selain nama fungsinya). Draft ini mengembalikan pola
   * tersimpan apa adanya; jangan klaim sudah "belajar" bila belum dicek. */
  var ctx = getBrandContext(brandName);
  if (!ctx) return { success: false, error: 'Brand tidak ditemukan.' };
  return { success: true, brand_name: brandName, learned_patterns: ctx.learned_patterns || '', pillar_learning: ctx.pillar_learning || '' };
}

/* ------------------------------ AI content ------------------------------ */

function generateAIContent(payload) {
  var brandName = (payload && payload.brand_name) || '';
  var topic = (payload && (payload.topic || payload.content_title)) || '';
  var ctx = brandName ? getBrandContext(brandName) : null;
  var apiKey = getGeminiApiKey_();

  if (apiKey) {
    try {
      var prompt = 'Buat ide konten untuk brand ' + brandName
        + (ctx && ctx.niche ? ' (niche: ' + ctx.niche + ')' : '')
        + (ctx && ctx.tone_of_voice ? ', tone: ' + ctx.tone_of_voice : '')
        + '. Topik: ' + topic + '. Jawab dalam Bahasa Indonesia, singkat.';
      var resp = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey,
        {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          muteHttpExceptions: true
        }
      );
      var data = JSON.parse(resp.getContentText());
      var text = data && data.candidates && data.candidates[0]
        && data.candidates[0].content && data.candidates[0].content.parts
        && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (text) return { success: true, content: text, source: 'gemini' };
    } catch (e) {
      console.error('generateAIContent Gemini gagal: ' + e.message);
    }
  }
  /* Fallback template — DILABELI, bukan berpura-pura hasil AI. */
  return {
    success: true,
    content: 'Ide konten untuk ' + (brandName || 'brand') + ': "' + topic + '". '
      + 'Buka dengan hook 3 detik, sampaikan satu poin utama, tutup dengan ajakan interaksi.',
    source: 'template'
  };
}

/* generateContentSuggestions — SATU definisi (asli ada dua; yang kedua dihapus). */
function generateContentSuggestions(brandName, count) {
  var n = count || 5;
  var ctx = brandName ? getBrandContext(brandName) : null;
  var pillars = ['Edukasi', 'Cerita Brand', 'Hiburan', 'Behind The Scenes', 'Interaksi', 'Mitos vs Fakta'];
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      brand_name: brandName || '',
      pillar: pillars[i % pillars.length],
      title: (ctx && ctx.niche ? ctx.niche + ': ' : '') + 'Ide ' + pillars[i % pillars.length] + ' #' + (i + 1)
    });
  }
  return { success: true, suggestions: out };
}

function analyzeContentPerformance(brandName) {
  /* Hanya metrik nyata dari CONTENT_METRICS. Tidak ada retensi buatan. */
  var metrics = DB_getAll(SHEET_NAMES.contentMetrics);
  var rows = brandName
    ? metrics.filter(function (m) { return String(m.brand_name) === String(brandName); })
    : metrics;
  var totalViews = 0, totalLikes = 0, totalComments = 0, totalShares = 0;
  rows.forEach(function (m) {
    totalViews += Number(m.views || 0);
    totalLikes += Number(m.likes || 0);
    totalComments += Number(m.comments || 0);
    totalShares += Number(m.shares || 0);
  });
  var engagement = totalLikes + totalComments + totalShares;
  return {
    success: true,
    brand_name: brandName || 'ALL',
    totalViews: totalViews,
    totalLikes: totalLikes,
    totalComments: totalComments,
    totalShares: totalShares,
    engagementRate: totalViews > 0 ? ((engagement / totalViews) * 100).toFixed(2) : '0.00'
    /* Tidak ada retention di sini: data retensi asli tidak tersedia. */
  };
}

/* ------------------------------ scheduling ------------------------------ */

function scheduleContent(payload) {
  if (!payload || !payload.brand_name || !payload.scheduled_date) {
    return { success: false, error: 'brand_name dan scheduled_date wajib diisi.' };
  }
  var existing = DB_getAll(SHEET_NAMES.contents).filter(function (c) {
    return String(c.brand_name) === String(payload.brand_name)
      && String(c.scheduled_date || '').slice(0, 10) === String(payload.scheduled_date).slice(0, 10)
      && String(c.content_status || '') !== 'Cancelled';
  });
  if (existing.length >= MAX_POSTS_PER_DAY) {
    return { success: false, error: 'Slot penuh: maksimal ' + MAX_POSTS_PER_DAY + ' konten/hari untuk brand ini.' };
  }
  var slotOk = true;
  if (payload.scheduled_time) {
    var slots = DB_getAll(SHEET_NAMES.scheduleSlots).filter(function (s) {
      return String(s.brand_name) === String(payload.brand_name)
        && String(s.time_slot || '').slice(0, 5) === String(payload.scheduled_time).slice(0, 5)
        && String(s.is_active) !== 'FALSE';
    });
    slotOk = slots.length > 0;
  }
  if (!slotOk) {
    return { success: false, error: 'Waktu tidak cocok dengan slot aktif brand ini.' };
  }
  return { success: true, scheduled: true };
}

/* ------------------------------ publishing ------------------------------ */

function publishContent(payload) {
  if (!payload || !payload.content_id || !payload.platform) {
    return { success: false, error: 'content_id dan platform wajib diisi.' };
  }
  var content = DB_getById(SHEET_NAMES.contents, payload.content_id, 'content_id');
  if (!content) return { success: false, error: 'Konten tidak ditemukan.' };
  var platform = String(payload.platform);
  var tok = _readToken_(content.brand_name, platform);
  if (!tok || !tok.access_token) {
    return { success: false, error: 'Token ' + platform + ' tidak tersedia — hubungkan ulang akun.' };
  }

  /* Publikasi nyata HANYA untuk Meta & TikTok (sesuai ringkasan asli).
   * Platform lain: JANGAN tandai Published, JANGAN beri published_url. */
  if (platform === 'TikTok') {
    return { success: false, simulated: true, error: 'Publikasi TikTok via GAS belum diimplementasikan di draft ini — konten TIDAK ditandai Published. Implementasikan upload video TikTok (init upload + publish) dan uji sebelum dipakai.' };
  }
  if (platform === 'Instagram' || platform === 'Meta' || platform === 'Facebook') {
    return { success: false, simulated: true, error: 'Publikasi Meta/Instagram via GAS belum diimplementasikan di draft ini — konten TIDAK ditandai Published. Implementasikan Graph API media container + publish dan uji sebelum dipakai.' };
  }
  return { success: false, simulated: true, error: 'Platform ' + platform + ' belum didukung publikasi nyata — konten TIDAK ditandai Published.' };
}

/* --------------------------- OAuth connections -------------------------- */

function saveOAuthConnection(payload) {
  if (!payload || !payload.brand_name || !payload.platform || !payload.access_token) {
    return { success: false, error: 'brand_name, platform, dan access_token wajib diisi.' };
  }
  _storeToken_(payload);
  var existing = DB_getAll(SHEET_NAMES.oauthConnections).filter(function (c) {
    return String(c.brand_name) === String(payload.brand_name)
      && String(c.platform) === String(payload.platform);
  })[0];
  var now = new Date().toISOString();
  var record = {
    conn_id: (existing && existing.conn_id) || generateUUID(),
    brand_name: payload.brand_name,
    platform: payload.platform,
    platform_user_id: payload.platform_user_id || '',
    username: payload.username || '',
    access_token: '', /* SENGAJA kosong — token hanya di Script Properties. */
    refresh_token: '',
    expires_at: payload.expires_at || '',
    status: 'Connected',
    connected_at: (existing && existing.connected_at) || now
  };
  var res = existing
    ? DB_update(SHEET_NAMES.oauthConnections, record.conn_id, 'conn_id', record)
    : DB_insert(SHEET_NAMES.oauthConnections, record);
  if (!res.success) return res;
  logActivity('save_oauth_connection', payload.brand_name + ' / ' + payload.platform);
  return { success: true, conn_id: record.conn_id };
}

function getOAuthConnections(brandName) {
  var all = DB_getAll(SHEET_NAMES.oauthConnections);
  var rows = brandName
    ? all.filter(function (c) { return String(c.brand_name) === String(brandName); })
    : all;
  return rows.map(_metaOnly_);
}

function removeOAuthConnection(connId) {
  var conn = DB_getById(SHEET_NAMES.oauthConnections, connId, 'conn_id');
  if (!conn) return { success: false, error: 'Koneksi tidak ditemukan.' };
  _deleteToken_(conn.brand_name, conn.platform);
  var res = DB_delete(SHEET_NAMES.oauthConnections, connId, 'conn_id');
  if (!res.success) return res;
  logActivity('delete_oauth_connection', conn.brand_name + ' / ' + conn.platform);
  return { success: true };
}

function refreshOAuthToken(brandName, platform) {
  var tok = _readToken_(brandName, platform);
  if (!tok || !tok.refresh_token) {
    return { success: false, error: 'Refresh token tidak tersedia untuk ' + brandName + ' / ' + platform + '.' };
  }
  var props = PropertiesService.getScriptProperties();
  try {
    if (platform === 'YouTube' || platform === 'Google') {
      var gRes = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'client_id=' + encodeURIComponent(props.getProperty('GOOGLE_CLIENT_ID') || '')
          + '&client_secret=' + encodeURIComponent(props.getProperty('GOOGLE_CLIENT_SECRET') || '')
          + '&refresh_token=' + encodeURIComponent(tok.refresh_token)
          + '&grant_type=refresh_token',
        muteHttpExceptions: true
      });
      var gData = JSON.parse(gRes.getContentText());
      if (!gData.access_token) return { success: false, error: 'Refresh Google gagal.' };
      tok.access_token = gData.access_token;
      _storeToken_({ brand_name: brandName, platform: platform, access_token: tok.access_token, refresh_token: tok.refresh_token, platform_user_id: tok.platform_user_id, expires_at: tok.expires_at });
      return { success: true };
    }
    if (platform === 'TikTok') {
      var tRes = UrlFetchApp.fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: 'client_key=' + encodeURIComponent(props.getProperty('TIKTOK_CLIENT_KEY') || '')
          + '&client_secret=' + encodeURIComponent(props.getProperty('TIKTOK_CLIENT_SECRET') || '')
          + '&grant_type=refresh_token&refresh_token=' + encodeURIComponent(tok.refresh_token),
        muteHttpExceptions: true
      });
      var tData = JSON.parse(tRes.getContentText());
      if (!tData.access_token) return { success: false, error: 'Refresh TikTok gagal.' };
      tok.access_token = tData.access_token;
      if (tData.refresh_token) tok.refresh_token = tData.refresh_token;
      _storeToken_({ brand_name: brandName, platform: platform, access_token: tok.access_token, refresh_token: tok.refresh_token, platform_user_id: tok.platform_user_id, expires_at: tok.expires_at });
      return { success: true };
    }
    if (platform === 'Instagram' || platform === 'Meta' || platform === 'Threads') {
      var mRes = UrlFetchApp.fetch('https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token'
        + '&client_id=' + encodeURIComponent(props.getProperty('META_APP_ID') || '')
        + '&client_secret=' + encodeURIComponent(props.getProperty('META_APP_SECRET') || '')
        + '&fb_exchange_token=' + encodeURIComponent(tok.access_token), { muteHttpExceptions: true });
      var mData = JSON.parse(mRes.getContentText());
      if (!mData.access_token) return { success: false, error: 'Refresh Meta gagal.' };
      tok.access_token = mData.access_token;
      _storeToken_({ brand_name: brandName, platform: platform, access_token: tok.access_token, refresh_token: tok.refresh_token, platform_user_id: tok.platform_user_id, expires_at: tok.expires_at });
      return { success: true };
    }
    /* LinkedIn / X: tercatat di ringkasan asli, tetapi endpoint &
     * kredensialnya TIDAK terverifikasi — jangan berpura-pura berhasil. */
    return { success: false, error: 'Refresh ' + platform + ' belum diverifikasi terhadap kode asli.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* --------------------------- inbox & notifikasi ------------------------- */

function getUnifiedInbox(brandName) {
  var all = DB_getAll(SHEET_NAMES.inbox);
  return brandName
    ? all.filter(function (m) { return String(m.brand_name) === String(brandName); })
    : all;
}

function markInboxItemRead(msgId) {
  var res = DB_update(SHEET_NAMES.inbox, msgId, 'msg_id', { status: 'Read' });
  return res.success ? { success: true } : { success: false, error: 'Pesan tidak ditemukan.' };
}

function getNotifications(brandName) {
  var all = DB_getAll(SHEET_NAMES.notifications);
  return brandName
    ? all.filter(function (n) { return String(n.brand_name) === String(brandName); })
    : all;
}

function markNotificationRead(notificationId) {
  var res = DB_update(SHEET_NAMES.notifications, notificationId, 'notification_id', { is_read: true });
  return res.success ? { success: true } : { success: false, error: 'Notifikasi tidak ditemukan.' };
}

function createNotification(brandName, message) {
  var res = DB_insert(SHEET_NAMES.notifications, {
    notification_id: generateUUID(),
    brand_name: brandName || '',
    message: message || '',
    is_read: false,
    created_at: new Date().toISOString()
  });
  return res.success ? { success: true } : res;
}

/* ------------------------------ campaigns ------------------------------- */

function getCampaigns() {
  return DB_getAll(SHEET_NAMES.campaigns);
}

function saveCampaign(payload) {
  if (!payload || !payload.name) return { success: false, error: 'name campaign wajib diisi.' };
  var record = payload;
  if (!record.campaign_id) record.campaign_id = generateUUID();
  var existing = DB_getById(SHEET_NAMES.campaigns, record.campaign_id, 'campaign_id');
  var res = existing
    ? DB_update(SHEET_NAMES.campaigns, record.campaign_id, 'campaign_id', record)
    : DB_insert(SHEET_NAMES.campaigns, record);
  if (!res.success) return res;
  return { success: true, campaign_id: record.campaign_id };
}
