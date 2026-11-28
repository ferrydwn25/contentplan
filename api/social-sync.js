/**
 * VERCEL SERVERLESS ENDPOINT (/api/social-sync)
 * Versi Parallel & Ultra-Fast (Promise.all + Timeout Guard) agar tidak pernah kena
 * batas timeout 10 detik Vercel saat menarik data GAS + YouTube + IG + TikTok + Threads.
 */

async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Auto-Refresh Access Token jika expired (YouTube 1 jam / TikTok 24 jam)
 * lalu simpan token baru ke Google Sheets agar tetap aktif.
 */
async function ensureFreshToken(conn, GAS_URL, API_SECRET) {
  if (!conn.refresh_token) return conn.access_token;

  try {
    if (conn.platform === "YouTube" && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      const r = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: conn.refresh_token,
          grant_type: "refresh_token"
        })
      }, 3500);
      const j = await r.json();
      if (j.access_token) {
        conn.access_token = j.access_token;
        fetchWithTimeout(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: API_SECRET,
            action: "save_oauth_connection",
            payload: { ...conn, access_token: j.access_token }
          })
        }, 3000).catch((saveErr) => console.error("Failed to save refreshed token:", saveErr.message));
      }
    }

    if (conn.platform === "TikTok" && process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) {
      const r = await fetchWithTimeout("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY,
          client_secret: process.env.TIKTOK_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: conn.refresh_token
        })
      }, 3500);
      const j = await r.json();
      if (j.access_token) {
        conn.access_token = j.access_token;
        conn.refresh_token = j.refresh_token || conn.refresh_token;
        fetchWithTimeout(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: API_SECRET,
            action: "save_oauth_connection",
            payload: { ...conn, access_token: j.access_token, refresh_token: conn.refresh_token }
          })
        }, 3000).catch((saveErr) => console.error("Failed to save refreshed token:", saveErr.message));
      }
    }
// Threads: token long-lived diperbarui dengan access_token yang masih
    // berlaku (bukan refresh_token). Hanya dicoba bila token sudah dekat
    // kedaluwarsa — field expires_at berasal dari data koneksi GAS bila ada.
    if (conn.platform === "Threads" && conn.access_token) {
      const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
      const needsRefresh = !expiresAt || expiresAt - Date.now() < 7 * 24 * 3600 * 1000;
      if (needsRefresh) {
        const r = await fetchWithTimeout(
          `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${conn.access_token}`,
          {}, 3500
        );
        const j = await r.json();
        if (j.access_token) {
          conn.access_token = j.access_token;
          fetchWithTimeout(GAS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: API_SECRET,
              action: "save_oauth_connection",
              payload: { ...conn, access_token: j.access_token }
            })
          }, 3000).catch((saveErr) => console.error("Failed to save refreshed Threads token:", saveErr.message));
        } else if (j.error) {
          console.error("Threads token refresh failed:", j.error.message || "unknown error");
        }
      }
    }

    // Instagram: alur OAuth saat ini tidak mengembalikan refresh_token
    // (token long-lived Meta). Cabang ini hanya berjalan bila suatu saat
    // GAS menyimpan refresh_token — dan tidak mengubah perilaku bila tidak ada.
    if (conn.platform === "Instagram" && conn.refresh_token && process.env.META_APP_ID && process.env.META_APP_SECRET) {
      const r = await fetchWithTimeout(
        `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${conn.refresh_token}`,
        {}, 3500
      );
      const j = await r.json();
      if (j.access_token) {
        conn.access_token = j.access_token;
        fetchWithTimeout(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: API_SECRET,
            action: "save_oauth_connection",
            payload: { ...conn, access_token: j.access_token }
          })
        }, 3000).catch((saveErr) => console.error("Failed to save refreshed Instagram token:", saveErr.message));
      } else if (j.error) {
        console.error("Instagram token refresh failed:", j.error.message || "unknown error");
      }
    }
  } catch (e) {
    console.error(`Token refresh failed for ${conn.platform} (${conn.username}):`, e.message);
  }

  return conn.access_token;
}

export default async function handler(req, res) {
  try {
    const GAS_URL = process.env.GAS_WEB_APP_URL;
    const API_SECRET = process.env.GAS_API_SECRET;

    if (!GAS_URL || !API_SECRET) {
      return res.status(200).json({
        success: false,
        error: "GAS_WEB_APP_URL atau GAS_API_SECRET belum diatur di Vercel Environment Variables."
      });
    }

    let bodyObj = {};
    if (req.method === "POST") {
      if (typeof req.body === "string") {
        try { bodyObj = JSON.parse(req.body); } catch (e) { console.error("social-sync: invalid JSON body:", e.message); bodyObj = {}; }
      } else if (req.body && typeof req.body === "object") {
        bodyObj = req.body;
      }
    }

    const params = req.method === "POST" ? bodyObj : (req.query || {});
    const { mode, brand, platform, msgId, replyText } = params;

    // 1. Ambil daftar koneksi OAuth & token dari GAS
    const tokenRes = await fetchWithTimeout(
      `${GAS_URL}?api=oauth_tokens&secret=${encodeURIComponent(API_SECRET)}`,
      { redirect: "follow" },
      6000
    );
    const rawTokenText = await tokenRes.text();
    let tokenData;
    try {
      tokenData = JSON.parse(rawTokenText);
    } catch (e) {
      return res.status(200).json({
        success: false,
        error: "GAS mengembalikan non-JSON. Pastikan sudah Deploy > Kelola Deployment > Edit > Versi Baru di Apps Script."
      });
    }

    if (!tokenData.success) {
      return res.status(200).json({
        success: false,
        error: tokenData.error || "Gagal membaca token OAuth dari GAS."
      });
    }

    const allConns = (tokenData.connections || []).filter(
      c => !brand || brand === "ALL" || c.brand_name === brand
    );

    // =========================================================================
    // MODE A: FETCH EXISTING FEEDS PER PLATFORM (PARALLEL)
    // =========================================================================
    if (mode === "feeds") {
      const targetConns = platform && platform !== "ALL"
        ? allConns.filter(c => c.platform === platform)
        : allConns;

      const feedTasks = targetConns.map(async (conn) => {
        if (!conn.access_token) return [];
        const token = await ensureFreshToken(conn, GAS_URL, API_SECRET);
        const posts = [];

        try {
          if (conn.platform === "YouTube") {
            const chEndpoint = conn.platform_user_id
              ? `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${conn.platform_user_id}`
              : "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true";
            const chRes = await fetchWithTimeout(chEndpoint, { headers: { Authorization: `Bearer ${token}` } });
            const chJson = await chRes.json();
            const uploadsPlaylistId = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

            let videoIds = [];
            if (uploadsPlaylistId) {
              const plRes = await fetchWithTimeout(
                `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=12`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              const plJson = await plRes.json();
              videoIds = (plJson.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
            }

            if (videoIds.length > 0) {
              const vRes = await fetchWithTimeout(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(",")}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              const vJson = await vRes.json();
              (vJson.items || []).forEach(v => {
                posts.push({
                  id: v.id,
                  platform: "YouTube",
                  brand_name: conn.brand_name,
                  username: conn.username,
                  title: v.snippet?.title || "YouTube Video",
                  caption: v.snippet?.description || "",
                  thumbnail: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.default?.url || "",
                  published_at: v.snippet?.publishedAt || "",
                  views: parseInt(v.statistics?.viewCount || 0),
                  likes: parseInt(v.statistics?.likeCount || 0),
                  comments: parseInt(v.statistics?.commentCount || 0),
                  permalink: `https://youtube.com/watch?v=${v.id}`
                });
              });
            }
          }

          if (conn.platform === "Instagram" && conn.platform_user_id) {
            const igRes = await fetchWithTimeout(
              `https://graph.facebook.com/v21.0/${conn.platform_user_id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=12&access_token=${conn.access_token}`
            );
            const igJson = await igRes.json();
            (igJson.data || []).forEach(m => {
              posts.push({
                id: m.id,
                platform: "Instagram",
                brand_name: conn.brand_name,
                username: conn.username,
                title: (m.caption || "Instagram Post").split("\n")[0].slice(0, 60),
                caption: m.caption || "",
                thumbnail: m.thumbnail_url || m.media_url || "",
                published_at: m.timestamp || "",
                views: 0,
                likes: parseInt(m.like_count || 0),
                comments: parseInt(m.comments_count || 0),
                permalink: m.permalink || ""
              });
            });
          }

          if (conn.platform === "Threads") {
            const thRes = await fetchWithTimeout(
              `https://graph.threads.net/v1.0/me/threads?fields=id,text,media_type,media_url,permalink,timestamp&limit=12&access_token=${conn.access_token}`
            );
            const thJson = await thRes.json();
            (thJson.data || []).forEach(t => {
              posts.push({
                id: t.id,
                platform: "Threads",
                brand_name: conn.brand_name,
                username: conn.username,
                title: (t.text || "Threads Post").slice(0, 65),
                caption: t.text || "",
                thumbnail: t.media_url || "",
                published_at: t.timestamp || "",
                views: 0,
                likes: 0,
                comments: 0,
                permalink: t.permalink || ""
              });
            });
          }

          if (conn.platform === "TikTok") {
            const ttRes = await fetchWithTimeout(
              "https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${conn.access_token}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ max_count: 12 })
              }
            );
            const ttJson = await ttRes.json();
            (ttJson.data?.videos || []).forEach(v => {
              posts.push({
                id: v.id,
                platform: "TikTok",
                brand_name: conn.brand_name,
                username: conn.username,
                title: v.title || "TikTok Video",
                caption: v.title || "",
                thumbnail: v.cover_image_url || "",
                published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : "",
                views: parseInt(v.view_count || 0),
                likes: parseInt(v.like_count || 0),
                comments: parseInt(v.comment_count || 0),
                shares: parseInt(v.share_count || 0),
                permalink: v.share_url || ""
              });
            });
          }
        } catch (err) {
          console.error(`Feeds ${conn.platform} error:`, err.message);
        }

        return posts;
      });

      const results = await Promise.all(feedTasks);
      const existingPosts = results.flat();

      return res.status(200).json({
        success: true,
        posts: existingPosts,
        connectedCount: targetConns.length
      });
    }

    // =========================================================================
    // MODE B: FETCH ANALYTICS & RETENTION INSIGHTS (PARALLEL & FAST)
    // =========================================================================
    if (mode === "analytics") {
      let summary = {
        totalFollowers: 0,
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        avgEngagementRate: "0.00",
        avgRetentionScore: 0,
        retentionIsEstimate: true,
        avgRetentionScoreEstimated: true,
        byPlatform: {
          YouTube: { followers: 0, views: 0, engagement: 0, retention: 0, retentionEstimated: true, posts: 0, connected: false },
          Instagram: { followers: 0, views: 0, engagement: 0, retention: 0, retentionEstimated: true, posts: 0, connected: false },
          TikTok: { followers: 0, views: 0, engagement: 0, retention: 0, retentionEstimated: true, posts: 0, connected: false },
          Threads: { followers: 0, views: 0, engagement: 0, retention: 0, retentionEstimated: true, posts: 0, connected: false }
        },
        topPosts: [],
        insights: []
      };

      let apiWarnings = [];

      const analyticsTasks = allConns.map(async (conn) => {
        if (!conn.access_token) return;
        const token = await ensureFreshToken(conn, GAS_URL, API_SECRET);
        const p = conn.platform;

        try {
          if (p === "YouTube") {
            const chUrl = conn.platform_user_id
              ? `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${conn.platform_user_id}`
              : "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true";

            const chRes = await fetchWithTimeout(chUrl, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const chJson = await chRes.json();
            if (chJson.error) {
              apiWarnings.push(`YouTube (${conn.username}): ${chJson.error.message}`);
              return;
            }
            const channelItem = chJson.items?.[0];
            if (!channelItem) {
              apiWarnings.push(`YouTube (${conn.username}): Channel tidak ditemukan pada akun Google ini. Pastikan memilih Brand Account channel saat login OAuth.`);
              return;
            }

            // Badge "API Live" hanya setelah API YouTube menjawab sukses.
            summary.byPlatform.YouTube.connected = true;

            const subs = parseInt(channelItem.statistics?.subscriberCount || 0);
            const chTotalViews = parseInt(channelItem.statistics?.viewCount || 0);
            summary.totalFollowers += subs;
            summary.byPlatform.YouTube.followers += subs;

            const uploadsId = channelItem.contentDetails?.relatedPlaylists?.uploads;
            let ids = [];
            if (uploadsId) {
              const plRes = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsId}&maxResults=15`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              const plJson = await plRes.json();
              ids = (plJson.items || []).map(x => x.contentDetails?.videoId).filter(Boolean);
            }

            if (ids.length > 0) {
              const vRes = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              const vJson = await vRes.json();
              (vJson.items || []).forEach(v => {
                const views = parseInt(v.statistics?.viewCount || 0);
                const likes = parseInt(v.statistics?.likeCount || 0);
                const comments = parseInt(v.statistics?.commentCount || 0);
                const eng = likes + comments;
                const er = views > 0 ? ((eng / views) * 100) : 0;
                // ESTIMASI dari engagement rate — bukan data retensi asli platform.
                const estRetention = views > 0 ? Math.min(94, Math.round(48 + er * 3.8)) : 0;

                summary.totalViews += views;
                summary.totalLikes += likes;
                summary.totalComments += comments;
                summary.byPlatform.YouTube.views += views;
                summary.byPlatform.YouTube.engagement += eng;
                summary.byPlatform.YouTube.posts += 1;
                summary.byPlatform.YouTube.retention = estRetention;

                summary.topPosts.push({
                  platform: "YouTube",
                  brand: conn.brand_name,
                  title: v.snippet?.title || "YouTube Video",
                  views,
                  engagement: eng,
                  er: er.toFixed(2) + "%",
                  retention: estRetention + "%",
                  retentionEstimated: true
                });
              });
            } else if (chTotalViews > 0) {
              summary.totalViews += chTotalViews;
              summary.byPlatform.YouTube.views += chTotalViews;
            }
          }

          if (p === "Instagram") {
            let igUserId = conn.platform_user_id;
            // Jika platform_user_id kosong saat login awal, coba cari otomatis dari me/accounts
            if (!igUserId) {
              const pgRes = await fetchWithTimeout(`https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account{id,username}&access_token=${conn.access_token}`);
              const pgJson = await pgRes.json();
              const linked = (pgJson.data || []).find(pg => pg.instagram_business_account);
              if (linked) igUserId = linked.instagram_business_account.id;
            }

            if (!igUserId) {
              apiWarnings.push(`Instagram (${conn.username}): Akun IG Business belum tertaut ke Facebook Page.`);
              return;
            }

            const [profRes, mediaRes] = await Promise.all([
              fetchWithTimeout(`https://graph.facebook.com/v21.0/${igUserId}?fields=followers_count,media_count&access_token=${conn.access_token}`),
              fetchWithTimeout(`https://graph.facebook.com/v21.0/${igUserId}/media?fields=id,caption,like_count,comments_count,media_type&limit=10&access_token=${conn.access_token}`)
            ]);

            const profJson = await profRes.json();
            if (profJson.error) {
              apiWarnings.push(`Instagram (${conn.username}): ${profJson.error.message}`);
              return;
            }

            // Badge "API Live" hanya setelah API Instagram menjawab sukses.
            summary.byPlatform.Instagram.connected = true;

            const foll = parseInt(profJson.followers_count || 0);
            summary.totalFollowers += foll;
            summary.byPlatform.Instagram.followers += foll;

            const mediaJson = await mediaRes.json();
            const mediaItems = (mediaJson.data || []).slice(0, 6);

            // Tarik reach secara PARALEL (bukan sequential loop) agar <1 detik
            const reachResults = await Promise.all(
              mediaItems.map(async (m) => {
                try {
                  const insRes = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${m.id}/insights?metric=reach&access_token=${conn.access_token}`, {}, 2500);
                  const insJson = await insRes.json();
                  return parseInt(insJson.data?.[0]?.values?.[0]?.value || 0);
                } catch (e) {
                  console.error(`Instagram reach fetch failed for media ${m.id}:`, e.message);
                  return 0;
                }
              })
            );

            mediaItems.forEach((m, idx) => {
              const reach = reachResults[idx] || 0;
              const likes = parseInt(m.like_count || 0);
              const comments = parseInt(m.comments_count || 0);
              const eng = likes + comments;
              const denom = reach > 0 ? reach : (foll > 0 ? foll : 100);
              const er = (eng / denom) * 100;
              // ESTIMASI dari engagement rate — bukan data retensi asli platform.
              const estRetention = reach > 0 ? Math.min(92, Math.round(45 + er * 4)) : 0;

              summary.totalViews += reach;
              summary.totalLikes += likes;
              summary.totalComments += comments;
              summary.byPlatform.Instagram.views += reach;
              summary.byPlatform.Instagram.engagement += eng;
              summary.byPlatform.Instagram.posts += 1;
              summary.byPlatform.Instagram.retention = estRetention;

              summary.topPosts.push({
                platform: "Instagram",
                brand: conn.brand_name,
                title: (m.caption || "Instagram Post").slice(0, 55),
                views: reach,
                engagement: eng,
                er: er.toFixed(2) + "%",
                retention: estRetention > 0 ? estRetention + "%" : "N/A",
                retentionEstimated: true
              });
            });
          }

          if (p === "TikTok") {
            const [uRes, vRes] = await Promise.all([
              fetchWithTimeout("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count", {
                headers: { Authorization: `Bearer ${token}` }
              }),
              fetchWithTimeout("https://open.tiktokapis.com/v2/video/list/?fields=id,title,view_count,like_count,comment_count,share_count", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ max_count: 15 })
              })
            ]);
            const uJson = await uRes.json();
            if (uJson.error && uJson.error.code !== "ok") {
              apiWarnings.push(`TikTok (${conn.username}): ${uJson.error.message} — Klik tombol × lalu Hubungkan ulang TikTok untuk izin user.info.stats & video.list.`);
              return;
            }

            // Badge "API Live" hanya setelah API TikTok menjawab sukses.
            summary.byPlatform.TikTok.connected = true;

            const userData = uJson.data?.user || {};
            if (userData.follower_count === undefined) {
              apiWarnings.push(`TikTok (${conn.username}): Token lama belum memiliki izin 'user.info.stats'. Silakan klik × di sidebar lalu klik Hubungkan TikTok ulang.`);
            }
            const foll = parseInt(userData.follower_count || 0);
            summary.totalFollowers += foll;
            summary.byPlatform.TikTok.followers += foll;

            const vJson = await vRes.json();
            if (vJson.error && vJson.error.code !== "ok") {
              apiWarnings.push(`TikTok Videos (${conn.username}): ${vJson.error.message}`);
            }
            (vJson.data?.videos || []).forEach(v => {
              const views = parseInt(v.view_count || 0);
              const likes = parseInt(v.like_count || 0);
              const comments = parseInt(v.comment_count || 0);
              const shares = parseInt(v.share_count || 0);
              const eng = likes + comments + shares;
              const er = views > 0 ? ((eng / views) * 100) : 0;
              // ESTIMASI dari engagement rate — bukan data retensi asli platform.
              const estRetention = views > 0 ? Math.min(95, Math.round(50 + er * 3.5)) : 0;

              summary.totalViews += views;
              summary.totalLikes += likes;
              summary.totalComments += comments;
              summary.totalShares += shares;
              summary.byPlatform.TikTok.views += views;
              summary.byPlatform.TikTok.engagement += eng;
              summary.byPlatform.TikTok.posts += 1;
              summary.byPlatform.TikTok.retention = estRetention;

              summary.topPosts.push({
                platform: "TikTok",
                brand: conn.brand_name,
                title: v.title || "TikTok Video",
                views,
                engagement: eng,
                er: er.toFixed(2) + "%",
                retention: estRetention + "%",
                retentionEstimated: true
              });
            });
          }

          if (p === "Threads") {
            const thIns = await fetchWithTimeout(`https://graph.threads.net/v1.0/me/threads_insights?metric=views,likes,replies,reposts,followers_count&access_token=${conn.access_token}`);
            const thJson = await thIns.json();
            if (thJson.error) {
              apiWarnings.push(`Threads (${conn.username}): ${thJson.error.message}`);
              return;
            }

            // Badge "API Live" hanya setelah API Threads menjawab sukses.
            summary.byPlatform.Threads.connected = true;

            (thJson.data || []).forEach(m => {
              const val = parseInt(m.total_value?.value || m.values?.[0]?.value || 0);
              if (m.name === "followers_count") {
                summary.totalFollowers += val;
                summary.byPlatform.Threads.followers += val;
              } else if (m.name === "views") {
                summary.totalViews += val;
                summary.byPlatform.Threads.views += val;
              } else if (m.name === "likes") {
                summary.totalLikes += val;
                summary.byPlatform.Threads.engagement += val;
              } else if (m.name === "replies") {
                summary.totalComments += val;
                summary.byPlatform.Threads.engagement += val;
              }
            });
          }
        } catch (err) {
          apiWarnings.push(`${p} (${conn.username}): ${err.message}`);
        }
      });

      await Promise.all(analyticsTasks);

      const totalEng = summary.totalLikes + summary.totalComments + summary.totalShares;
      summary.avgEngagementRate = summary.totalViews > 0 ? ((totalEng / summary.totalViews) * 100).toFixed(2) : "0.00";

      const retValues = Object.values(summary.byPlatform).map(x => x.retention).filter(r => r > 0);
      summary.avgRetentionScore = retValues.length > 0 ? Math.round(retValues.reduce((a, b) => a + b, 0) / retValues.length) : 0;

      summary.topPosts.sort((a, b) => b.views - a.views);
      summary.topPosts = summary.topPosts.slice(0, 10);

      if (apiWarnings.length > 0) {
        apiWarnings.forEach(w => summary.insights.push(`⚠️ ${w}`));
      }
      if (summary.topPosts.length > 0) {
        summary.insights.push(`Konten performa tertinggi: "${summary.topPosts[0].title}" di ${summary.topPosts[0].platform} (${summary.topPosts[0].views.toLocaleString()} views, ER ${summary.topPosts[0].er}).`);
      }
      if (summary.avgRetentionScore > 0) {
        summary.insights.push(`Rata-rata Hook & Watch Retention (ESTIMASI, bukan data retensi asli): ${summary.avgRetentionScore}% — ${summary.avgRetentionScore >= 65 ? "Sangat kuat, pertahankan pola 3 detik pertama!" : "Perkuat visual hook di 3 detik awal."}`);
      }
      if (allConns.length === 0) {
        summary.insights.push("Belum ada akun OAuth berstatus Connected untuk brand ini. Klik 'Hubungkan' di panel kiri.");
      }

      return res.status(200).json({ success: true, summary });
    }

    // =========================================================================
    // MODE C: SYNC UNIFIED INBOX COMMENTS (PARALLEL)
    // =========================================================================
    if (mode === "sync_inbox") {
      const inboxTasks = allConns.map(async (conn) => {
        if (!conn.access_token) return [];
        const list = [];

        try {
          if (conn.platform === "YouTube" && conn.platform_user_id) {
            const cRes = await fetchWithTimeout(
              `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${conn.platform_user_id}&maxResults=15`,
              { headers: { Authorization: `Bearer ${conn.access_token}` } }
            );
            const cJson = await cRes.json();
            (cJson.items || []).forEach(item => {
              const top = item.snippet?.topLevelComment;
              if (top) {
                list.push({
                  msg_id: top.id,
                  brand_name: conn.brand_name,
                  platform: "YouTube",
                  post_id: item.snippet.videoId || "",
                  post_title: "YouTube Video",
                  sender_username: top.snippet.authorDisplayName || "@viewer",
                  comment_text: top.snippet.textDisplay || "",
                  received_at: top.snippet.publishedAt
                });
              }
            });
          }

          if (conn.platform === "Instagram" && conn.platform_user_id) {
            const mRes = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${conn.platform_user_id}/media?fields=id,caption,comments{id,text,username,timestamp}&limit=5&access_token=${conn.access_token}`);
            const mJson = await mRes.json();
            (mJson.data || []).forEach(m => {
              (m.comments?.data || []).forEach(cm => {
                list.push({
                  msg_id: cm.id,
                  brand_name: conn.brand_name,
                  platform: "Instagram",
                  post_id: m.id,
                  post_title: (m.caption || "Instagram Post").slice(0, 40),
                  sender_username: `@${cm.username}`,
                  comment_text: cm.text,
                  received_at: cm.timestamp
                });
              });
            });
          }

          if (conn.platform === "Threads") {
            const thRes = await fetchWithTimeout(`https://graph.threads.net/v1.0/me/threads?fields=id,text&limit=5&access_token=${conn.access_token}`);
            const thJson = await thRes.json();
            const threads = thJson.data || [];
            await Promise.all(threads.map(async (t) => {
              const repRes = await fetchWithTimeout(`https://graph.threads.net/v1.0/${t.id}/replies?fields=id,text,username,timestamp&access_token=${conn.access_token}`);
              const repJson = await repRes.json();
              (repJson.data || []).forEach(r => {
                list.push({
                  msg_id: r.id,
                  brand_name: conn.brand_name,
                  platform: "Threads",
                  post_id: t.id,
                  post_title: (t.text || "Threads").slice(0, 40),
                  sender_username: `@${r.username}`,
                  comment_text: r.text,
                  received_at: r.timestamp
                });
              });
            }));
          }
        } catch (err) {
          console.error(`Inbox ${conn.platform} error:`, err.message);
        }

        return list;
      });

      const fetchedComments = (await Promise.all(inboxTasks)).flat();

      if (fetchedComments.length > 0) {
        await fetchWithTimeout(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: API_SECRET,
            action: "sync_inbox_batch",
            comments: fetchedComments
          })
        });
      }

      return res.status(200).json({ success: true, fetchedCount: fetchedComments.length });
    }

    // =========================================================================
    // MODE D: POST REAL REPLY TO PLATFORM API + UPDATE SHEET
    // =========================================================================
    if (mode === "send_reply") {
      const conn = allConns.find(c => c.platform === platform);
      let apiSent = false;

      if (conn && conn.access_token && msgId) {
        try {
          if (platform === "YouTube") {
            const r = await fetchWithTimeout("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
              method: "POST",
              headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ snippet: { parentId: msgId, textOriginal: replyText } })
            });
            if (r.ok) apiSent = true;
          } else if (platform === "Instagram") {
            const r = await fetchWithTimeout(`https://graph.facebook.com/v21.0/${msgId}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ message: replyText, access_token: conn.access_token })
            });
            if (r.ok) apiSent = true;
          } else if (platform === "Threads") {
            const createRes = await fetchWithTimeout(`https://graph.threads.net/v1.0/me/threads`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ media_type: "TEXT", text: replyText, reply_to_id: msgId, access_token: conn.access_token })
            });
            const createJson = await createRes.json();
            if (createJson.id) {
              await fetchWithTimeout(`https://graph.threads.net/v1.0/me/threads_publish`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ creation_id: createJson.id, access_token: conn.access_token })
              });
              apiSent = true;
            }
          }
        } catch (repErr) {
          console.error(`Reply error on ${platform}:`, repErr.message);
        }
      }

      await fetchWithTimeout(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: API_SECRET,
          action: "reply_inbox",
          msgId,
          replyText
        })
      });

      return res.status(200).json({ success: true, apiSent });
    }

    return res.status(200).json({ success: false, error: "Invalid mode" });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}
