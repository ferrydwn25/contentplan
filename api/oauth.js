/**
 * OAUTH (/api/oauth) — ContentPlan
 *
 * Alur OAuth 2.0 untuk Instagram, Threads, TikTok, dan YouTube.
 *
 * KEAMANAN (perubahan Fase 1):
 * - TIDAK ADA lagi nilai fallback yang tertulis di kode. Semua client ID /
 *   secret / config ID WAJIB berasal dari Environment Variables Vercel.
 *   Bila sebuah env belum diset, pengguna diarahkan kembali dengan pesan
 *   error yang jelas, bukan memakai nilai bawaan.
 * - State OAuth divalidasi: harus JSON dengan platform yang dikenal,
 *   brand yang valid, nonce, dan masa berlaku (maks. 15 menit).
 *   Catatan: ini validasi stateless. Perlindungan CSRF penuh membutuhkan
 *   penyimpanan server-side (mis. cookie terenkripsi / KV store); lihat README.
 * - Token hasil tukar-menukar HANYA dikirim ke GAS lewat server-side
 *   (dengan GAS_API_SECRET) dan tidak pernah dikembalikan ke browser.
 */

const ALLOWED_PLATFORMS = ["Instagram", "Threads", "TikTok", "YouTube"];
const STATE_TTL_MS = 15 * 60 * 1000;

function isValidBrand(brand) {
  return typeof brand === "string" && brand.trim().length > 0 && brand.trim().length <= 100;
}

function makeState(platform, brand) {
  const payload = {
    platform,
    brand,
    nonce: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    exp: Date.now() + STATE_TTL_MS
  };
  return encodeURIComponent(JSON.stringify(payload));
}

function parseAndValidateState(rawState) {
  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(rawState));
  } catch (e) {
    throw new Error("STATE_tidak_valid");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("STATE_tidak_valid");
  if (!ALLOWED_PLATFORMS.includes(parsed.platform)) throw new Error("STATE_platform_tidak_dikenal");
  if (!isValidBrand(parsed.brand)) throw new Error("STATE_brand_tidak_valid");
  if (typeof parsed.nonce !== "string" || parsed.nonce.length < 8) throw new Error("STATE_nonce_tidak_valid");
  if (typeof parsed.exp !== "number" || parsed.exp <= Date.now() || parsed.exp > Date.now() + STATE_TTL_MS) {
    throw new Error("STATE_kadaluarsa");
  }
  return parsed;
}

function redirectError(res, message) {
  return res.redirect(`/?oauth_error=${encodeURIComponent(message)}`);
}

export default async function handler(req, res) {
  const { platform, brand, code, action } = req.query;
  const BASE_URL = `https://${req.headers.host}`;
  const DEFAULT_REDIRECT_URI = `${BASE_URL}/api/oauth`;

  // 1. INISIASI REDIRECT KE HALAMAN LOGIN PLATFORM
  if (action === "connect") {
    if (!ALLOWED_PLATFORMS.includes(platform)) return redirectError(res, "PLATFORM_tidak_dikenal");
    if (!isValidBrand(brand)) return redirectError(res, "BRAND_tidak_valid");
    const state = makeState(platform, brand);

    if (platform === "Instagram") {
      const clientId = process.env.META_APP_ID;
      const configId = process.env.META_IG_CONFIG_ID;
      if (!clientId || !configId) return redirectError(res, "META_APP_ID_atau_META_IG_CONFIG_ID_belum_diset");
      const igRedirectUri = `${BASE_URL}/`;
      return res.redirect(
        `https://www.facebook.com/dialog/oauth?client_id=${clientId}&config_id=${configId}&display=popup&override_default_response_type=true&redirect_uri=${encodeURIComponent(igRedirectUri)}&response_type=code&state=${state}&prompt=login`
      );
    }

    if (platform === "Threads") {
      const clientId = process.env.THREADS_APP_ID || process.env.META_APP_ID;
      if (!clientId) return redirectError(res, "THREADS_APP_ID_belum_diset");
      const scope = "threads_basic,threads_content_publish,threads_manage_replies";
      return res.redirect(`https://threads.net/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(DEFAULT_REDIRECT_URI)}&scope=${scope}&response_type=code&state=${state}`);
    }

    if (platform === "TikTok") {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      if (!clientKey) return redirectError(res, "TIKTOK_CLIENT_KEY_belum_diset");
      const scope = "user.info.basic,user.info.stats,video.list,video.publish,video.upload";
      return res.redirect(`https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(DEFAULT_REDIRECT_URI)}&state=${state}`);
    }

    if (platform === "YouTube") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return redirectError(res, "GOOGLE_CLIENT_ID_belum_diset");
      const scope = encodeURIComponent("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly");
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(DEFAULT_REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`);
    }
  }

  // 2. CALLBACK: TUKAR AUTHORIZATION CODE MENJADI ACCESS TOKEN ASLI
  if (code && req.query.state) {
    try {
      const parsedState = parseAndValidateState(req.query.state);
      const p = parsedState.platform;
      let accessToken = "";
      let refreshToken = "";
      let platformUserId = "";
      let username = `@${parsedState.brand.toLowerCase().replace(/\s+/g, "")}_${p.toLowerCase()}`;

      // A. YOUTUBE TOKEN EXCHANGE
      if (p === "YouTube") {
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
          throw new Error("GOOGLE_CLIENT_ID_atau_GOOGLE_CLIENT_SECRET_belum_diset");
        }
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: DEFAULT_REDIRECT_URI,
            grant_type: "authorization_code"
          })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || "";

        const ytRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const ytData = await ytRes.json();
        if (ytData.items && ytData.items.length > 0) {
          platformUserId = ytData.items[0].id;
          username = ytData.items[0].snippet.title;
        }
      }

      // B. INSTAGRAM UNIFIED LOGIN TOKEN EXCHANGE (redirect_uri memakai root URL sesuai Meta)
      else if (p === "Instagram") {
        const clientId = process.env.META_APP_ID;
        const clientSecret = process.env.META_APP_SECRET;
        if (!clientId || !clientSecret) throw new Error("META_APP_ID_atau_META_APP_SECRET_belum_diset");
        const igRedirectUri = `${BASE_URL}/`;
        const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(igRedirectUri)}&client_secret=${clientSecret}&code=${encodeURIComponent(code)}`;
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error.message || "Gagal tukar token Instagram Unified Login");
        accessToken = tokenData.access_token;

        const igRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account{id,username}&access_token=${accessToken}`);
        const igData = await igRes.json();
        if (igData.data) {
          const linkedPage = igData.data.find(page => page.instagram_business_account);
          if (linkedPage && linkedPage.instagram_business_account) {
            platformUserId = linkedPage.instagram_business_account.id;
            username = `@${linkedPage.instagram_business_account.username}`;
          }
        }
      }

      // C. THREADS TOKEN EXCHANGE
      else if (p === "Threads") {
        const clientId = process.env.THREADS_APP_ID || process.env.META_APP_ID;
        const clientSecret = process.env.THREADS_APP_SECRET || process.env.META_APP_SECRET;
        if (!clientId || !clientSecret) throw new Error("THREADS_APP_ID_atau_APP_SECRET_belum_diset");
        const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            redirect_uri: DEFAULT_REDIRECT_URI,
            code
          })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error_message) throw new Error(tokenData.error_message);
        accessToken = tokenData.access_token;
        platformUserId = String(tokenData.user_id || "");
      }

      // D. TIKTOK TOKEN EXCHANGE
      else if (p === "TikTok") {
        if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
          throw new Error("TIKTOK_CLIENT_KEY_atau_TIKTOK_CLIENT_SECRET_belum_diset");
        }
        const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY,
            client_secret: process.env.TIKTOK_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: DEFAULT_REDIRECT_URI
          })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || "";
        platformUserId = tokenData.open_id || "";

        // Ambil nama/username asli akun TikTok (kegagalan di sini tidak menggagalkan login)
        try {
          const ttProfileRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const ttProfileJson = await ttProfileRes.json();
          const uObj = ttProfileJson.data?.user;
          if (uObj) {
            username = uObj.username ? `@${uObj.username}` : (uObj.display_name || username);
          }
        } catch (e) {
          console.error("TikTok profile fetch failed (non-fatal):", e.message);
        }
      }

      // 3. SIMPAN TOKEN KE GAS (server-side saja; draft GAS wajib menyimpan
      //    token di Script Properties, BUKAN sebagai teks biasa di Sheets)
      if (!process.env.GAS_WEB_APP_URL || !process.env.GAS_API_SECRET) {
        throw new Error("GAS_WEB_APP_URL_atau_GAS_API_SECRET_belum_diset");
      }
      const saveRes = await fetch(process.env.GAS_WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.GAS_API_SECRET,
          action: "save_oauth_connection",
          payload: {
            brand_name: parsedState.brand,
            platform: p,
            platform_user_id: platformUserId,
            username: username,
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_at: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString()
          }
        })
      });
      if (!saveRes.ok) throw new Error("Gagal_menyimpan_koneksi_OAuth_di_GAS");

      return res.redirect(`/?oauth_success=${encodeURIComponent(p)}`);
    } catch (err) {
      console.error("OAuth callback error:", err.message);
      return redirectError(res, err.message);
    }
  }

  return res.status(400).json({ error: "Invalid OAuth request" });
}
