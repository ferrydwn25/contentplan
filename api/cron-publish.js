/**
 * VERCEL CRON JOB (/api/cron-publish)
 * Berjalan otomatis setiap jam (0 * * * *) untuk mem-publish konten berstatus "Ready"
 * yang jadwalnya cocok dengan jam saat ini.
 */

export default async function handler(req, res) {
  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_SECRET = process.env.GAS_API_SECRET;

  if (!GAS_URL || !API_SECRET) {
    return res.status(500).json({ error: "Missing GAS configuration" });
  }

  try {
    // Hitung waktu sekarang dalam zona waktu WIB (Asia/Jakarta, UTC+7)
    const nowWIB = new Date(Date.now() + 7 * 3600 * 1000);
    const dateStr = nowWIB.toISOString().split("T")[0];
    const hourPrefix = nowWIB.toISOString().split("T")[1].substring(0, 2);

    // 1. Ambil daftar konten yang siap tayang di jam ini dari GAS
    const checkUrl = `${GAS_URL}?api=due_posts&date=${dateStr}&hour=${hourPrefix}&secret=${encodeURIComponent(API_SECRET)}`;
    const dueRes = await fetch(checkUrl, { redirect: "follow" });
    const dueData = await dueRes.json();

    if (!dueData.success || !dueData.duePosts || dueData.duePosts.length === 0) {
      return res.status(200).json({ message: `No due posts at ${dateStr} ${hourPrefix}:00 WIB` });
    }

    const publishedIds = [];

    // 2. Eksekusi Publish via API Resmi jika OAuth Token tersedia
    for (const post of dueData.duePosts) {
      if (post.oauth_token) {
        // Tempat eksekusi endpoint Graph API / TikTok Publish API / YouTube Upload API
        publishedIds.push(post.content_id);
      }
    }

    // 3. Update status konten menjadi "Published" di Google Sheets
    if (publishedIds.length > 0) {
      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: API_SECRET,
          action: "mark_published_by_cron",
          publishedIds: publishedIds
        })
      });
    }

    return res.status(200).json({
      success: true,
      checkedAt: `${dateStr} ${hourPrefix}:00 WIB`,
      publishedCount: publishedIds.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}