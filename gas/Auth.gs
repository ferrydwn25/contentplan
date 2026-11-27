/**
 * ============================================================================
 * Auth.gs — DRAFT (file BARU, belum ada di proyek Apps Script Ferry)
 * ============================================================================
 * STATUS: DRAFT. BELUM DIVERIFIKASI LEWAT DEPLOY. BELUM DITEMPEL.
 * Jangan tempel file ini sebelum tugas deploy GAS lewat browser
 * (browser-task fe6f7c37) selesai — menempel sekarang akan bentrok.
 *
 * TUJUAN: halaman login untuk ContentPlan. Hari ini siapa pun yang tahu
 * link contentplanz.vercel.app bisa membuka dan mengubah data sosmed Ferry.
 * File ini menambahkan login ADITIF: tidak menghapus jalur secret GAS
 * yang sudah ada (gas-proxy server-to-server, social-sync, cron tetap
 * jalan seperti semula), dan tidak mengubah satu pun fungsi yang sudah ada
 * di Code.gs / VercelBridge.gs / BleamFeatures.gs / Database.gs / Media.gs.
 *
 * KEPUTUSAN DESAIN (lihat LOGIN-PLAN.md untuk alasan lengkap):
 * 1. Password TIDAK PERNAH disimpan plaintext. Yang disimpan di tab USERS
 *    hanya: password_hash = SHA-256 hex dari (salt + ':' + password),
 *    dan salt per user. Hash dihitung dengan Utilities.computeDigest.
 *    Tidak ada password default di draft ini. Akun pertama dibuat Ferry
 *    sendiri (lihat "Cara membuat akun pertama" di LOGIN-PLAN.md).
 * 2. Sesi disimpan di tab SESSIONS di Sheets (bukan Script Properties),
 *    supaya Ferry bisa melihat dan mencabut sesi dengan menghapus baris —
 *    sesuai permintaan Ferry bahwa data login disimpan di Google Sheet.
 *    Token sesi adalah Utilities.getUuid(), berlaku 24 jam.
 *    Catatan risiko: siapa pun yang bisa membaca Sheet bisa membaca token
 *    sesi yang masih berlaku — batas kepercayaan yang sama dengan tab
 *    USERS dan OAUTH_CONNECTIONS. Akses Sheet = akses admin. Jangan
 *    bagikan Sheet ke orang lain.
 * 3. Rate limit login: maks 5 percobaan gagal per username per 15 menit,
 *    dihitung dari baris ACTIVITY_LOG (action 'login_failed'). Percobaan
 *    ke-6 ditolak dengan pesan umum yang sama seperti login gagal.
 * 4. Pesan error login selalu umum ("Username atau password salah.")
 *    supaya tidak membocorkan apakah username itu ada atau tidak.
 * 5. Nama fungsi di file ini TIDAK bentrok dengan yang sudah ada
 *    (dicek terhadap Code/VercelBridge/BleamFeatures/Database/Media/
 *    Setup/Config di main, 2026-11-27): tidak ada fungsi bernama
 *    authLogin, authLogout, authValidateSession, authCreateUser,
 *    authHashPassword_, authFindUser_, authCountRecentFailures_,
 *    authPurgeExpiredSessions_ di file lain.
 * ============================================================================
 */

/* Masa berlaku sesi: 24 jam. Batas percobaan gagal: 5 per 15 menit. */
var AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
var AUTH_MAX_FAILED_LOGINS = 5;
var AUTH_FAILED_WINDOW_MS = 15 * 60 * 1000;

/* ------------------------- hashing password ------------------------------ */

/* Salt baru per user: UUID + waktu, supaya dua user dengan password sama
 * tetap punya hash berbeda. */
function authNewSalt_() {
  return Utilities.getUuid() + '-' + new Date().getTime();
}

/* SHA-256 hex dari (salt + ':' + password). Jangan ubah format ini setelah
 * ada user yang dibuat — hash lama tidak akan cocok lagi. */
function authHashPassword_(password, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password),
    Utilities.Charset.UTF_8
  );
  var hex = raw.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
  return hex;
}

/* --------------------------- cari user ----------------------------------- */

/* Cari baris USERS berdasarkan username (perbandingan persis, case-sensitive).
 * Mengembalikan objek baris (DB_getAll) atau null. */
function authFindUser_(username) {
  var users = DB_getAll(SHEET_NAMES.users);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username) === String(username)) return users[i];
  }
  return null;
}

/* --------------------------- rate limit ---------------------------------- */

/* Hitung percobaan login gagal untuk username ini dalam 15 menit terakhir,
 * dari ACTIVITY_LOG (kolom: timestamp, action, detail, actor — detail
 * berisi username). Bila ACTIVITY_LOG belum ada, anggap 0 (fail-open
 * untuk hitungannya saja; login tetap dicek hash seperti biasa). */
function authCountRecentFailures_(username) {
  try {
    var rows = DB_getAll(SHEET_NAMES.activityLog);
    var cutoff = new Date().getTime() - AUTH_FAILED_WINDOW_MS;
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].action) !== 'login_failed') continue;
      if (String(rows[i].detail) !== String(username)) continue;
      var t = new Date(rows[i].timestamp).getTime();
      if (!isNaN(t) && t >= cutoff) count++;
    }
    return count;
  } catch (e) {
    return 0;
  }
}

/* --------------------------- sesi ---------------------------------------- */

/* Buat sesi baru untuk user, simpan di tab SESSIONS, kembalikan token. */
function authCreateSession_(user) {
  var now = new Date();
  var token = Utilities.getUuid();
  DB_insert(SHEET_NAMES.sessions, {
    session_id: token,
    user_id: user.user_id,
    username: user.username,
    expires_at: new Date(now.getTime() + AUTH_SESSION_TTL_MS).toISOString(),
    created_at: now.toISOString()
  });
  return token;
}

/* Validasi token sesi. Mengembalikan { valid, user_id, username, role,
 * expires_at } atau { valid: false }. Token kedaluwarsa dihapus dari
 * SESSIONS supaya tab tidak menumpuk (best-effort, kegagalan hapus
 * tidak menggagalkan validasi). */
function authValidateSession(sessionToken) {
  if (!sessionToken) return { valid: false };
  var rows = DB_getAll(SHEET_NAMES.sessions);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].session_id) !== String(sessionToken)) continue;
    var exp = new Date(rows[i].expires_at).getTime();
    if (isNaN(exp) || exp <= new Date().getTime()) {
      try { DB_delete(SHEET_NAMES.sessions, rows[i].session_id, 'session_id'); } catch (e) {}
      return { valid: false, error: 'Sesi sudah kedaluwarsa.' };
    }
    var user = authFindUser_(rows[i].username);
    if (!user || String(user.is_active) === 'FALSE') return { valid: false };
    return {
      valid: true,
      user_id: user.user_id,
      username: user.username,
      role: user.role || 'admin',
      expires_at: rows[i].expires_at
    };
  }
  return { valid: false };
}

/* Hapus semua sesi user (dipakai saat logout dari semua perangkat, dan
 * saat akun dinonaktifkan). */
function authRevokeSessionsForUser_(username) {
  var rows = DB_getAll(SHEET_NAMES.sessions);
  rows.forEach(function (r) {
    if (String(r.username) === String(username)) {
      try { DB_delete(SHEET_NAMES.sessions, r.session_id, 'session_id'); } catch (e) {}
    }
  });
}

/* Hapus sesi-sesi yang sudah kedaluwarsa (dipanggil sekali tiap login
 * berhasil; best-effort, jangan gagalkan login bila ada error). */
function authPurgeExpiredSessions_() {
  try {
    var rows = DB_getAll(SHEET_NAMES.sessions);
    var now = new Date().getTime();
    rows.forEach(function (r) {
      var exp = new Date(r.expires_at).getTime();
      if (!isNaN(exp) && exp <= now) {
        try { DB_delete(SHEET_NAMES.sessions, r.session_id, 'session_id'); } catch (e) {}
      }
    });
  } catch (e) {}
}

/* --------------------------- aksi login ---------------------------------- */

/* POST action=login — SATU-SATUNYA aksi yang TIDAK butuh secret GAS
 * (lihat Code-login-snippet.md: doPost memeriksa action ini SEBELUM
 * validateSecret). Body: { action: 'login', username, password }.
 * Mengembalikan { success, session_token, username, role, expires_at }
 * atau { success: false, error: 'Username atau password salah.' }.
 * Pesan gagal selalu sama, baik username tidak ada, akun nonaktif,
 * password salah, maupun rate limit tercapai. */
function authLogin(payload) {
  var username = String((payload && payload.username) || '').trim();
  var password = String((payload && payload.password) || '');
  var genericError = { success: false, error: 'Username atau password salah.' };
  if (!username || !password) return genericError;

  /* Rate limit: 5 gagal / 15 menit per username. */
  if (authCountRecentFailures_(username) >= AUTH_MAX_FAILED_LOGINS) {
    try { logActivity('login_failed', username); } catch (e) {}
    return genericError;
  }

  var user = authFindUser_(username);
  if (!user || String(user.is_active) === 'FALSE' || !user.password_hash || !user.salt) {
    try { logActivity('login_failed', username); } catch (e) {}
    return genericError;
  }
  /* Perbandingan hash constant-time (secretsEqual_ sudah ada di Config.gs). */
  if (!secretsEqual_(authHashPassword_(password, user.salt), String(user.password_hash))) {
    try { logActivity('login_failed', username); } catch (e) {}
    return genericError;
  }

  var token = authCreateSession_(user);
  authPurgeExpiredSessions_();
  try { logActivity('login_ok', username); } catch (e) {}
  return {
    success: true,
    session_token: token,
    username: user.username,
    role: user.role || 'admin',
    expires_at: new Date(new Date().getTime() + AUTH_SESSION_TTL_MS).toISOString()
  };
}

/* POST action=logout — tidak butuh secret, tapi butuh session_token yang
 * valid (atau token apa pun: logout yang tokennya tidak dikenal tetap
 * dianggap berhasil, supaya frontend tidak terjebak). */
function authLogout(payload) {
  var token = (payload && (payload.session_token || payload.sessionToken)) || '';
  if (token) {
    try { DB_delete(SHEET_NAMES.sessions, String(token), 'session_id'); } catch (e) {}
  }
  return { success: true };
}

/* POST action=validate_session — tidak butuh secret. Dipakai gas-proxy
 * untuk memeriksa token sebelum meneruskan aksi pengguna, dan dipakai
 * frontend untuk memeriksa sesi saat halaman dimuat.
 * Body: { action: 'validate_session', session_token }.
 * Mengembalikan { success: true, username, role, expires_at } atau
 * { success: false, error } — TANPA token baru (sesi tidak diperpanjang
 * otomatis; login ulang setelah 24 jam). */
function authValidateSessionAction(payload) {
  var token = (payload && (payload.session_token || payload.sessionToken)) || '';
  var v = authValidateSession(token);
  if (!v.valid) return { success: false, error: v.error || 'Sesi tidak valid.' };
  return {
    success: true,
    username: v.username,
    role: v.role,
    expires_at: v.expires_at
  };
}

/* --------------------------- buat user ----------------------------------- */

/* Membuat user baru. FUNGSI INI HANYA BOLEH DIPANGGIL DARI EDITOR
 * APPS SCRIPT (Run > createFirstAdminUser) oleh Ferry sendiri, atau
 * dari sesi admin yang sudah login — BUKAN dari aksi publik tanpa
 * autentikasi. routePostAction_ di Code.gs TIDAK mendaftarkan
 * 'create_user' sebagai aksi publik; lihat Code-login-snippet.md.
 *
 * Cara membuat akun pertama (Ferry, saat bangun):
 *   1. Di editor Apps Script, buka Auth.gs, pilih fungsi
 *      createFirstAdminUser, klik Run.
 *   2. Fungsi ini memakai username 'ferrydwn' dan password yang Ferry
 *      ketik di bawah (GANTI nilai 'GANTI_PASSWORD_INI' dengan password
 *      pilihan Ferry SEBELUM Run — jangan biarkan nilai contoh ini).
 *   3. Bila user 'ferrydwn' sudah ada, fungsi tidak menimpa apa pun dan
 *      mengembalikan pesan bahwa user sudah ada.
 * JANGAN tulis password Ferry di file ini setelah dipakai: hapus nilainya
 * dan kembalikan ke 'GANTI_PASSWORD_INI'. */
function createFirstAdminUser() {
  var USERNAME = 'ferrydwn';
  var PASSWORD = 'GANTI_PASSWORD_INI'; /* <-- Ferry: ganti ini sebelum Run. */
  if (!PASSWORD || PASSWORD === 'GANTI_PASSWORD_INI') {
    throw new Error('Isi dulu PASSWORD di createFirstAdminUser dengan password pilihan Ferry, lalu Run lagi.');
  }
  return authCreateUser(USERNAME, PASSWORD, 'admin');
}

/* Membuat satu user (dipakai createFirstAdminUser dan, kelak, oleh admin
 * yang sudah login). Menolak bila username sudah ada atau password
 * kurang dari 8 karakter. Password TIDAK PERNAH disimpan — hanya hash
 * dan salt-nya. */
function authCreateUser(username, password, role) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username) return { success: false, error: 'Username wajib diisi.' };
  if (password.length < 8) {
    return { success: false, error: 'Password minimal 8 karakter.' };
  }
  if (authFindUser_(username)) {
    return { success: false, error: 'Username sudah dipakai.' };
  }
  var salt = authNewSalt_();
  var now = new Date().toISOString();
  var res = DB_insert(SHEET_NAMES.users, {
    user_id: generateUUID(),
    username: username,
    password_hash: authHashPassword_(password, salt),
    salt: salt,
    role: role || 'admin',
    is_active: 'TRUE',
    created_at: now,
    updated_at: now
  });
  if (!res.success) return res;
  try { logActivity('create_user', username); } catch (e) {}
  return { success: true, username: username, role: role || 'admin' };
}

/* Menonaktifkan user dan mencabut semua sesinya. Dipakai dari editor
 * (bukan aksi publik). */
function authDeactivateUser(username) {
  var user = authFindUser_(username);
  if (!user) return { success: false, error: 'User tidak ditemukan.' };
  user.is_active = 'FALSE';
  user.updated_at = new Date().toISOString();
  var res = DB_update(SHEET_NAMES.users, user.user_id, 'user_id', user);
  if (!res.success) return res;
  authRevokeSessionsForUser_(username);
  return { success: true };
}
