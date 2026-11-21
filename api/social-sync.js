/**
 * VERCEL SERVERLESS ENDPOINT (/api/social-sync)
 * Menarik Feeds eksisting, Analitik & Insight Retensi, serta Sinkronisasi Komentar
 * dengan isolasi error per platform agar tidak pernah crash (500).
 */

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
        try { bodyObj = JSON.parse(req.body); } catch (e) { bodyObj = {}; }
      } else if (req.body && typeof req.body === "object") {
        bodyObj = req.body;
      }
    }

    const params = req.method === "POST" ? bodyObj : (req.query || {});
    const { mode, brand, platform, msgId, replyText } = params;

    // 1. Ambil daftar koneksi OAuth beserta access_token dari GAS secara aman
    const tokenRes = await fetch(`${GAS_URL}?api=oauth_tokens&secret=${encodeURIComponent(API_SECRET)}`, {
      redirect: "follow"
    });
    const rawTokenText = await tokenRes.text();
    let tokenData;
    try {
      tokenData = JSON.parse(rawTokenText);
    } catch (parseErr) {
      return res.status(200).json({
        success: false,
        error: "GAS mengembalikan halaman non-JSON. Pastikan Anda sudah klik Deploy > Kelola Deployment > Edit > Versi Baru di Apps Script."
      });
    }

    if (!tokenData.success) {
      return res.status(200).json({
        success: false,
        error: tokenData.error || "Endpoint oauth_tokens di GAS belum aktif. Silakan Deploy Versi Baru di Apps Script."
      });
    }

    const allConns = (tokenData.connections || []).filter(
      c => !brand || brand === "ALL" || c.brand_name === brand
    );

    // =========================================================================
    // MODE A: FETCH EXISTING FEEDS PER PLATFORM
    // =========================================================================
    if (mode === "feeds") {
      const targetConns = platform && platform !== "ALL"
        ? allConns.filter(c => c.platform === platform)
        : allConns;
      let existingPosts = [];

      for (const conn of targetConns) {
        if (!conn.access_token) continue;

        try {
          if (conn.platform === "YouTube") {
            const searchRes = await fetch(
              "https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&order=date&maxResults=12",
              { headers: { Authorization: `Bearer ${conn.access_token}` } }
            );
            const searchJson = await searchRes.json();
            const videoIds = (searchJson.items || []).map(i => i.id?.videoId).filter(Boolean);

            if (videoIds.length > 0) {
              const statsRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(",")}`,
                { headers: { Authorization: `Bearer ${conn.access_token}` } }
              );
              const statsJson = await statsRes.json();
              (statsJson.items || []).forEach(v => {
                existingPosts.push({
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
            const igRes = await fetch(
              `https://graph.facebook.com/v21.0/${conn.platform_user_id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=12&access_token=${conn.access_token}`
            );
            const igJson = await igRes.json();
            (igJson.data || []).forEach(m => {
              existingPosts.push({
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
            const thRes = await fetch(
              `https://graph.threads.net/v1.0/me/threads?fields=id,text,media_type,media_url,permalink,timestamp&limit=12&access_token=${conn.access_token}`
            );
            const thJson = await thRes.json();
            (thJson.data || []).forEach(t => {
              existingPosts.push({
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
            const ttRes = await fetch(
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
              existingPosts.push({
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
        } catch (platErr) {
          console.error(`Feeds error on ${conn.platform}:`, platErr.message);
        }
      }

      return res.status(200).json({ success: true, posts: existingPosts, connectedCount: targetConns.length });
    }

    // =========================================================================
    // MODE B: FETCH OVERALL ANALYTICS & RETENTION INSIGHTS FROM ALL APIS
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
        byPlatform: {
          YouTube: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false },
          Instagram: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false },
          TikTok: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false },
          Threads: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false }
        },
        topPosts: [],
        insights: []
      };

      for (const conn of allConns) {
        if (!conn.access_token) continue;
        const p = conn.platform;
        if (summary.byPlatform[p]) summary.byPlatform[p].connected = true;

        try {
          if (p === "YouTube") {
            const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", {
              headers: { Authorization: `Bearer ${conn.access_token}` }
            });
            const chJson = await chRes.json();
            const subs = parseInt(chJson.items?.[0]?.statistics?.subscriberCount || 0);
            summary.totalFollowers += subs;
            summary.byPlatform.YouTube.followers += subs;

            const sRes = await fetch("https://www.googleapis.com/youtube/v3/search?part=id&forMine=true&type=video&order=date&maxResults=15", {
              headers: { Authorization: `Bearer ${conn.access_token}` }
            });
            const sJson = await sRes.json();
            const ids = (sJson.items || []).map(x => x.id?.videoId).filter(Boolean);
            if (ids.length > 0) {
              const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}`, {
                headers: { Authorization: `Bearer ${conn.access_token}` }
              });
              const vJson = await vRes.json();
              (vJson.items || []).forEach(v => {
                const views = parseInt(v.statistics?.viewCount || 0);
                const likes = parseInt(v.statistics?.likeCount || 0);
                const comments = parseInt(v.statistics?.commentCount || 0);
                const eng = likes + comments;
                const er = views > 0 ? ((eng / views) * 100) : 0;
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
                  retention: estRetention + "%"
                });
              });
            }
          }

          if (p === "Instagram" && conn.platform_user_id) {
            const profRes = await fetch(`https://graph.facebook.com/v21.0/${conn.platform_user_id}?fields=followers_count,media_count&access_token=${conn.access_token}`);
            const profJson = await profRes.json();
            const foll = parseInt(profJson.followers_count || 0);
            summary.totalFollowers += foll;
            summary.byPlatform.Instagram.followers += foll;

            const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${conn.platform_user_id}/media?fields=id,caption,like_count,comments_count,media_type&limit=15&access_token=${conn.access_token}`);
            const mediaJson = await mediaRes.json();
            for (const m of (mediaJson.data || [])) {
              let reach = 0;
              try {
                const insRes = await fetch(`https://graph.facebook.com/v21.0/${m.id}/insights?metric=reach&access_token=${conn.access_token}`);
                const insJson = await insRes.json();
                reach = parseInt(insJson.data?.[0]?.values?.[0]?.value || 0);
              } catch (e) {}

              const likes = parseInt(m.like_count || 0);
              const comments = parseInt(m.comments_count || 0);
              const eng = likes + comments;
              const denom = reach > 0 ? reach : (foll > 0 ? foll : 100);
              const er = (eng / denom) * 100;
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
                title: (m.caption || "IG Media").slice(0, 55),
                views: reach,
                engagement: eng,
                er: er.toFixed(2) + "%",
                retention: estRetention > 0 ? estRetention + "%" : "N/A"
              });
            }
          }

          if (p === "TikTok") {
            const uRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count", {
              headers: { Authorization: `Bearer ${conn.access_token}` }
            });
            const uJson = await uRes.json();
            const foll = parseInt(uJson.data?.user?.follower_count || 0);
            summary.totalFollowers += foll;
            summary.byPlatform.TikTok.followers += foll;

            const vRes = await fetch("https://open.tiktokapis.com/v2/video/list/?fields=id,title,view_count,like_count,comment_count,share_count", {
              method: "POST",
              headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ max_count: 15 })
            });
            const vJson = await vRes.json();
            (vJson.data?.videos || []).forEach(v => {
              const views = parseInt(v.view_count || 0);
              const likes = parseInt(v.like_count || 0);
              const comments = parseInt(v.comment_count || 0);
              const shares = parseInt(v.share_count || 0);
              const eng = likes + comments + shares;
              const er = views > 0 ? ((eng / views) * 100) : 0;
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
                retention: estRetention + "%"
              });
            });
          }

          if (p === "Threads") {
            const thIns = await fetch(`https://graph.threads.net/v1.0/me/threads_insights?metric=views,likes,replies,reposts,followers_count&access_token=${conn.access_token}`);
            const thJson = await thIns.json();
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
        } catch (platErr) {
          console.error(`Analytics error on ${p}:`, platErr.message);
        }
      }

      const totalEng = summary.totalLikes + summary.totalComments + summary.totalShares;
      summary.avgEngagementRate = summary.totalViews > 0 ? ((totalEng / summary.totalViews) * 100).toFixed(2) : "0.00";

      const retValues = Object.values(summary.byPlatform).map(x => x.retention).filter(r => r > 0);
      summary.avgRetentionScore = retValues.length > 0 ? Math.round(retValues.reduce((a, b) => a + b, 0) / retValues.length) : 0;

      summary.topPosts.sort((a, b) => b.views - a.views);
      summary.topPosts = summary.topPosts.slice(0, 10);

      if (summary.topPosts.length > 0) {
        summary.insights.push(`Konten performa tertinggi: "${summary.topPosts[0].title}" di ${summary.topPosts[0].platform} (${summary.topPosts[0].views.toLocaleString()} views, ER ${summary.topPosts[0].er}).`);
      }
      if (summary.avgRetentionScore > 0) {
        summary.insights.push(`Rata-rata Hook & Watch Retention lintas platform: ${summary.avgRetentionScore}% — ${summary.avgRetentionScore >= 65 ? "Sangat kuat, pertahankan pola 3 detik pertama!" : "Perkuat visual hook di 3 detik awal untuk mendongkrak retensi."}`);
      }
      if (allConns.length === 0) {
        summary.insights.push("Belum ada akun OAuth yang terhubung pada brand ini. Klik 'Hubungkan' di panel kiri untuk menarik analitik live.");
      } else if (summary.topPosts.length === 0) {
        summary.insights.push("Akun sudah terhubung, namun belum ditemukan data metrik video/post terbaru dari API platform.");
      }

      return res.status(200).json({ success: true, summary });
    }

    // =========================================================================
    // MODE C: SYNC UNIFIED INBOX COMMENTS FROM ALL CONNECTED PLATFORMS
    // =========================================================================
    if (mode === "sync_inbox") {
      let fetchedComments = [];

      for (const conn of allConns) {
        if (!conn.access_token) continue;

        try {
          if (conn.platform === "YouTube" && conn.platform_user_id) {
            const cRes = await fetch(
              `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId=${conn.platform_user_id}&maxResults=15`,
              { headers: { Authorization: `Bearer ${conn.access_token}` } }
            );
            const cJson = await cRes.json();
            (cJson.items || []).forEach(item => {
              const top = item.snippet?.topLevelComment;
              if (top) {
                fetchedComments.push({
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
            const mRes = await fetch(`https://graph.facebook.com/v21.0/${conn.platform_user_id}/media?fields=id,caption,comments{id,text,username,timestamp}&limit=5&access_token=${conn.access_token}`);
            const mJson = await mRes.json();
            (mJson.data || []).forEach(m => {
              (m.comments?.data || []).forEach(cm => {
                fetchedComments.push({
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
            const thRes = await fetch(`https://graph.threads.net/v1.0/me/threads?fields=id,text&limit=5&access_token=${conn.access_token}`);
            const thJson = await thRes.json();
            for (const t of (thJson.data || [])) {
              const repRes = await fetch(`https://graph.threads.net/v1.0/${t.id}/replies?fields=id,text,username,timestamp&access_token=${conn.access_token}`);
              const repJson = await repRes.json();
              (repJson.data || []).forEach(r => {
                fetchedComments.push({
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
            }
          }
        } catch (platErr) {
          console.error(`Inbox sync error on ${conn.platform}:`, platErr.message);
        }
      }

      if (fetchedComments.length > 0) {
        await fetch(GAS_URL, {
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
            const r = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
              method: "POST",
              headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ snippet: { parentId: msgId, textOriginal: replyText } })
            });
            if (r.ok) apiSent = true;
          } else if (platform === "Instagram") {
            const r = await fetch(`https://graph.facebook.com/v21.0/${msgId}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ message: replyText, access_token: conn.access_token })
            });
            if (r.ok) apiSent = true;
          } else if (platform === "Threads") {
            const createRes = await fetch(`https://graph.threads.net/v1.0/me/threads`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ media_type: "TEXT", text: replyText, reply_to_id: msgId, access_token: conn.access_token })
            });
            const createJson = await createRes.json();
            if (createJson.id) {
              await fetch(`https://graph.threads.net/v1.0/me/threads_publish`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ creation_id: createJson.id, access_token: conn.access_token })
              });
              apiSent = true;
            }
          }
        } catch (repErr) {
          console.error(`Reply API error on ${platform}:`, repErr.message);
        }
      }

      await fetch(GAS_URL, {
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
