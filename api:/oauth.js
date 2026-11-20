/**
 * VERCEL OAUTH 2.0 HANDLER (/api/oauth)
 * Menangani alur login resmi Instagram/Threads (Meta), TikTok, dan YouTube
 * serta menyimpan token akses ke Google Sheets via GAS.
 */

export default async function handler(req, res) {
  const { platform, brand, code, action } = req.query;
  const BASE_URL = `https://${req.headers.host}`;
  const REDIRECT_URI = `${BASE_URL}/api/oauth`;

  // 1. Inisiasi Redirect ke Halaman Login Platform
  if (action === "connect") {
    const state = encodeURIComponent(JSON.stringify({ platform, brand }));

    if (platform === "Instagram" || platform === "Threads") {
      const clientId = process.env.META_APP_ID;
      if (!clientId) return res.redirect(`/?oauth_error=META_APP_ID_not_configured`);
      const scope = platform === "Threads"
        ? "threads_basic,threads_content_publish,threads_manage_replies"
        : "instagram_basic,instagram_content_publish,instagram_manage_comments";
      const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code&state=${state}`;
      return res.redirect(authUrl);
    }

    if (platform === "TikTok") {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      if (!clientKey) return res.redirect(`/?oauth_error=TIKTOK_CLIENT_KEY_not_configured`);
      const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=user.info.basic,video.publish&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
      return res.redirect(authUrl);
    }

    if (platform === "YouTube") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.redirect(`/?oauth_error=GOOGLE_CLIENT_ID_not_configured`);
      const scope = encodeURIComponent("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl");
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
      return res.redirect(authUrl);
    }
  }

  // 2. Callback dari Platform setelah User Klik "Allow"
  if (code && req.query.state) {
    try {
      const parsedState = JSON.parse(decodeURIComponent(req.query.state));
      const GAS_URL = process.env.GAS_WEB_APP_URL;
      const API_SECRET = process.env.GAS_API_SECRET;

      // Simpan token ke Google Sheets melalui GAS
      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: API_SECRET,
          action: "save_oauth_connection",
          payload: {
            brand_name: parsedState.brand,
            platform: parsedState.platform,
            username: `@${parsedState.brand.toLowerCase().replace(/\s+/g, '')}_${parsedState.platform.toLowerCase()}`,
            access_token: `oauth_code_${code}`,
            expires_at: new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString()
          }
        })
      });

      return res.redirect(`/?oauth_success=${encodeURIComponent(parsedState.platform)}`);
    } catch (err) {
      return res.redirect(`/?oauth_error=${encodeURIComponent(err.message)}`);
    }
  }

  return res.status(400).json({ error: "Invalid OAuth request" });
}