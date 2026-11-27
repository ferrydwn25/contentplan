/**
 * VERCEL SERVERLESS PROXY (/api/gas-proxy)
 * Menjembatani frontend Vercel dengan Google Apps Script.
 *
 * KEAMANAN (perubahan Fase 1):
 * - GET hanya boleh untuk endpoint "bootstrap" — SATU-SATUNYA endpoint baca
 *   yang dipakai frontend. Endpoint server-side seperti "oauth_tokens" dan
 *   "due_posts" TIDAK boleh lewat proxy ini, karena isinya token/konten
 *   terjadwal; keduanya hanya dipanggil langsung server-ke-server oleh
 *   api/social-sync.js dan api/cron-publish.js dengan secret mereka sendiri.
 * - POST hanya boleh untuk action yang benar-benar dipakai frontend
 *   (lihat POST_ACTION_ALLOWLIST). Action server-side seperti
 *   "save_oauth_connection", "sync_inbox_batch", "reply_inbox", dan
 *   "mark_published_by_cron" DITOLAK di sini.
 * - Field "secret" dari body klien selalu dibuang; yang dipakai hanya
 *   GAS_API_SECRET dari Environment Variables server.
 * - Respons GAS yang bukan JSON tidak lagi membuat server crash;
 *   dikembalikan sebagai 502 dengan pesan yang jelas.
 *
 * LOGIN (2026-11-27, GAS v8 sudah live):
 * - Aksi auth publik ("login", "logout", "validate_session") diteruskan
 *   TANPA secret — tujuannya justru mendapatkan / memeriksa sesi.
 * - Semua aksi pengguna lain dan GET "bootstrap" WAJIB session_token yang
 *   valid: proxy memvalidasinya dulu ke GAS (validate_session,
 *   server-ke-server dengan GAS_API_SECRET) sebelum meneruskan; tanpa sesi
 *   yang valid proxy mengembalikan 401 dan TIDAK meneruskan panggilan.
 * - Tanpa ini, halaman login hanya hiasan: proxy yang selalu menyuntikkan
 *   secret untuk semua orang berarti siapa pun bisa memanggil semua action
 *   tanpa login.
 */

const GET_ENDPOINT_ALLOWLIST = ["bootstrap"];

const POST_ACTION_ALLOWLIST = [
  "disconnect_oauth",
  "generate_batch",
  "delete_post",
  "ai_caption",
  "save_composer_post",
  "upload_asset",
  "toggle_slot",
  "delete_slot",
  "add_slot",
  "save_brand_context",
  "delete_brand_context",
  "learn_brand_style"
];

/* Aksi auth publik — BOLEH dipanggil tanpa sesi dan tanpa secret, karena
 * tujuannya justru mendapatkan / memeriksa sesi. Ketiga aksi ini di GAS
 * tidak butuh secret (Code.gs doPost merutekannya sebelum pemeriksaan
 * secret). */
const PUBLIC_AUTH_ACTIONS = ["login", "logout", "validate_session"];

/* Validasi session_token klien ke GAS, server-ke-server (memakai
 * GAS_API_SECRET, bukan token klien). True hanya bila GAS menjawab
 * { success: true }. Tanpa cache antar-request: sesi bisa dicabut
 * (baris SESSIONS dihapus) dan pencabutan harus langsung berlaku. */
async function isSessionValid(GAS_URL, API_SECRET, sessionToken) {
  if (!sessionToken || typeof sessionToken !== "string") return false;
  try {
    const { data } = await forwardToGas(GAS_URL, API_SECRET, {
      method: "POST",
      url: GAS_URL,
      body: { action: "validate_session", session_token: sessionToken, secret: API_SECRET }
    });
    return !!(data && data.success === true);
  } catch (e) {
    return false;
  }
}

async function forwardToGas(GAS_URL, API_SECRET, { method, url, body }) {
  const gasRes = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "follow"
  });
  const text = await gasRes.text();
  try {
    return { status: gasRes.ok ? 200 : 502, data: JSON.parse(text) };
  } catch (e) {
    return {
      status: 502,
      data: { success: false, error: "GAS mengembalikan respons bukan JSON. Periksa deployment Apps Script." }
    };
  }
}

export default async function handler(req, res) {
  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_SECRET = process.env.GAS_API_SECRET;

  if (!GAS_URL || !API_SECRET) {
    return res.status(500).json({
      success: false,
      error: "Environment variables GAS_WEB_APP_URL atau GAS_API_SECRET belum diset di Vercel."
    });
  }

  try {
    if (req.method === "GET") {
      const endpoint = req.query.api || "bootstrap";
      if (!GET_ENDPOINT_ALLOWLIST.includes(endpoint)) {
        return res.status(403).json({ success: false, error: `Endpoint "${endpoint}" tidak diizinkan lewat proxy ini.` });
      }
      /* LOGIN: bootstrap hanya untuk pengguna yang sudah login. */
      const sessionOk = await isSessionValid(GAS_URL, API_SECRET, req.query.session_token);
      if (!sessionOk) {
        return res.status(401).json({ success: false, error: "Sesi tidak valid. Silakan login lagi." });
      }
      const targetUrl = `${GAS_URL}?api=${encodeURIComponent(endpoint)}&secret=${encodeURIComponent(API_SECRET)}`;
      const { status, data } = await forwardToGas(GAS_URL, API_SECRET, { method: "GET", url: targetUrl });
      return res.status(status).json(data);
    }

    if (req.method === "POST") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const { secret: _clientSecret, action, ...rest } = body;
      /* LOGIN: aksi auth publik diteruskan TANPA secret. */
      if (typeof action === "string" && PUBLIC_AUTH_ACTIONS.includes(action)) {
        const { status, data } = await forwardToGas(GAS_URL, API_SECRET, { method: "POST", url: GAS_URL, body: { action, ...rest } });
        return res.status(status).json(data);
      }
      if (typeof action !== "string" || !POST_ACTION_ALLOWLIST.includes(action)) {
        return res.status(403).json({ success: false, error: `Action "${String(action)}" tidak diizinkan lewat proxy ini.` });
      }
      /* LOGIN: semua aksi pengguna lain wajib sesi yang valid. */
      const sessionOk = await isSessionValid(GAS_URL, API_SECRET, body.session_token);
      if (!sessionOk) {
        return res.status(401).json({ success: false, error: "Sesi tidak valid. Silakan login lagi." });
      }
      const payload = { ...rest, action, secret: API_SECRET };
      const { status, data } = await forwardToGas(GAS_URL, API_SECRET, { method: "POST", url: GAS_URL, body: payload });
      return res.status(status).json(data);
    }

    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("gas-proxy error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
