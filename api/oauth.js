export default async function handler(req, res) {
  const { platform, brand, code, action } = req.query;
  const BASE_URL = `https://${req.headers.host}`;
  const DEFAULT_REDIRECT_URI = `${BASE_URL}/api/oauth`;

  // 1. INISIASI REDIRECT KE HALAMAN LOGIN PLATFORM
  if (action === "connect") {
    const state = encodeURIComponent(JSON.stringify({ platform, brand }));

    if (platform === "Instagram") {
      const clientId = process.env.META_APP_ID || "1719082732943187";
      const configId = process.env.META_IG_CONFIG_ID || "1821758155697606";
      const igRedirectUri = `${BASE_URL}/`;
      return res.redirect(
        `https://www.facebook.com/dialog/oauth?client_id=${clientId}&config_id=${configId}&display=popup&override_default_response_type=true&redirect_uri=${encodeURIComponent(igRedirectUri)}&response_type=code&state=${state}&prompt=login`
      );
    }

    if (platform === "Threads") {
      const clientId = process.env.THREADS_APP_ID || process.env.META_APP_ID;
      if (!clientId) return res.redirect(`/?oauth_error=THREADS_APP_ID_belum_diset`);
      const scope = "threads_basic,threads_content_publish,threads_manage_replies";
      return res.redirect(`https://threads.net/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(DEFAULT_REDIRECT_URI)}&scope=${scope}&response_type=code&state=${state}`);
    }

    if (platform === "TikTok") {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      if (!clientKey) return res.redirect(`/?oauth_error=TIKTOK_CLIENT_KEY_belum_diset`);
      const scope = "user.info.basic,user.info.stats,video.list,video.publish,video.upload";
      return res.redirect(`https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(DEFAULT_REDIRECT_URI)}&state=${state}`);
    }

    if (platform === "YouTube") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.redirect(`/?oauth_error=GOOGLE_CLIENT_ID_belum_diset`);
      const scope = encodeURIComponent("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly");
      return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(DEFAULT_REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`);
    }
  }

  // 2. CALLBACK: TUKAR AUTHORIZATION CODE MENJADI ACCESS TOKEN ASLI
  if (code && req.query.state) {
    try {
      const parsedState = JSON.parse(decodeURIComponent(req.query.state));
      const p = parsedState.platform;
      let accessToken = "";
      let refreshToken = "";
      let platformUserId = "";
      let username = `@${parsedState.brand.toLowerCase().replace(/\s+/g, '')}_${p.toLowerCase()}`;

      // A. YOUTUBE TOKEN EXCHANGE
      if (p === "YouTube") {
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
        const clientId = process.env.META_APP_ID || "1719082732943187";
        const igRedirectUri = `${BASE_URL}/`;
        const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${clientId}&redirect_uri=${encodeURIComponent(igRedirectUri)}&client_secret=${process.env.META_APP_SECRET}&code=${encodeURIComponent(code)}`;
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
        const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.THREADS_APP_ID || process.env.META_APP_ID,
            client_secret: process.env.THREADS_APP_SECRET || process.env.META_APP_SECRET,
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

        // Ambil nama/username asli akun TikTok
        try {
          const ttProfileRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const ttProfileJson = await ttProfileRes.json();
          const uObj = ttProfileJson.data?.user;
          if (uObj) {
            username = uObj.username ? `@${uObj.username}` : (uObj.display_name || username);
          }
        } catch (e) {}
      }

      // 3. SIMPAN TOKEN ASLI KE GOOGLE SHEETS VIA GAS
      await fetch(process.env.GAS_WEB_APP_URL, {
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

      return res.redirect(`/?oauth_success=${encodeURIComponent(p)}`);
    } catch (err) {
      return res.redirect(`/?oauth_error=${encodeURIComponent(err.message)}`);
    }
  }

  return res.status(400).json({ error: "Invalid OAuth request" });
}
