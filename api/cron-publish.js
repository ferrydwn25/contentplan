/**
 * CRON PUBLISH (/api/cron-publish) — ContentPlan
 *
 * PENTING — Vercel gratis TIDAK menjalankan Vercel Cron. Endpoint ini
 * SENGAJA dipicu dari LUAR (external trigger), misalnya layanan cron
 * eksternal yang memanggil URL endpoint ini tiap jam. JANGAN menambahkan
 * "crons" di vercel.json dengan harapan berjalan di paket gratis.
 * Lihat README bagian "Cron eksternal" untuk cara memicunya.
 *
 * KEAMANAN (perubahan Fase 2):
 * - Bila env CRON_SECRET diset, pemanggil WAJIB mengirimkannya lewat
 *   header `Authorization: Bearer <secret>` atau `x-cron-secret`.
 *   Bila secret tidak cocok / tidak ada -> 401, tidak ada yang diproses.
 *   Bila CRON_SECRET belum diset, endpoint tetap berjalan tetapi respons
 *   menyertakan peringatan agar secret segera diset (jangan dibiarkan
 *   terbuka tanpa secret di produksi).
 * - Endpoint ini TIDAK PERNAH menandai konten sebagai "Published" tanpa
 *   publikasi nyata yang berhasil. Sebelumnya, konten ditandai Published
 *   hanya karena ada token OAuth — perilaku itu sudah dihapus.
 * - Publikasi nyata per platform BELUM diimplementasikan di endpoint ini
 *   (butuh upload media + alur publish tiap platform). Sampai fungsi
 *   publishPost() di bawah diisi implementasi nyata dan teruji, endpoint
 *   hanya melaporkan konten yang jatuh tempo sebagai "skipped" dan
 *   publishedCount selalu 0. JANGAN memanggil action
 *   "mark_published_by_cron" ke GAS dari sini sampai ada bukti publish.
 */

function checkCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return { ok: true, configured: false };
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const headerSecret = req.headers["x-cron-secret"] || "";
  const provided = bearer || headerSecret;
  if (!provided || provided !== expected) return { ok: false, configured: true };
  return { ok: true, configured: true };
}

/**
 * Titik ekstensi publikasi nyata.
 * Kembalikan { ok: true, platformPostId } HANYA bila API platform
 * benar-benar mengonfirmasi publikasi (mis. mengembalikan ID postingan).
 * Saat ini selalu gagal dengan alasan "belum diimplementasikan" — dan
 * itu disengaja, agar tidak ada konten yang ditandai Published secara palsu.
 */
async function publishPost(post) {
  return {
    ok: false,
    reason: "publish_belum_diimplementasikan",
    detail: `Publikasi otomatis untuk ${post.platform || "platform tidak dikenal"} belum diimplementasikan di cron-publish.js.`
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const GAS_URL = process.env.GAS_WEB_APP_URL;
  const API_SECRET = process.env.GAS_API_SECRET;

  if (!GAS_URL || !API_SECRET) {
    return res.status(500).json({ success: false, error: "Missing GAS configuration" });
  }

  const cronCheck = checkCronSecret(req);
  if (!cronCheck.ok) {
    return res.status(401).json({ success: false, error: "Unauthorized: CRON_SECRET tidak cocok." });
  }

  try {
    // Hitung waktu sekarang dalam zona waktu WIB (Asia/Jakarta, UTC+7)
    const nowWIB = new Date(Date.now() + 7 * 3600 * 1000);
    const dateStr = nowWIB.toISOString().split("T")[0];
    const hourPrefix = nowWIB.toISOString().split("T")[1].substring(0, 2);

    // 1. Ambil daftar konten yang siap tayang di jam ini dari GAS
    const checkUrl = `${GAS_URL}?api=due_posts&date=${dateStr}&hour=${hourPrefix}&secret=${encodeURIComponent(API_SECRET)}`;
    const dueRes = await fetch(checkUrl, { redirect: "follow" });
    const dueText = await dueRes.text();
    let dueData;
    try {
      dueData = JSON.parse(dueText);
    } catch (e) {
      return res.status(502).json({ success: false, error: "GAS mengembalikan respons bukan JSON." });
    }

    if (!dueData.success || !dueData.duePosts || dueData.duePosts.length === 0) {
      return res.status(200).json({
        success: true,
        checkedAt: `${dateStr} ${hourPrefix}:00 WIB`,
        dueCount: 0,
        publishedCount: 0,
        skipped: [],
        message: `No due posts at ${dateStr} ${hourPrefix}:00 WIB`,
        warning: cronCheck.configured ? undefined : "CRON_SECRET belum diset di Vercel — segera set agar endpoint ini tidak bisa dipicu sembarang orang."
      });
    }

    // 2. Coba publikasikan tiap konten. HANYA yang benar-benar berhasil
    //    yang boleh ditandai Published — dan saat ini tidak ada yang berhasil,
    //    karena publishPost() belum diimplementasikan (lihat di atas).
    const publishedIds = [];
    const skipped = [];
    for (const post of dueData.duePosts) {
      const result = await publishPost(post);
      if (result.ok) {
        publishedIds.push(post.content_id);
      } else {
        skipped.push({ content_id: post.content_id, platform: post.platform || null, reason: result.reason });
        console.warn(`cron-publish skipped ${post.content_id}:`, result.reason);
      }
    }

    // 3. TIDAK ADA pemanggilan mark_published_by_cron di sini bila
    //    publishedIds kosong. Bila suatu hari publishPost() berhasil,
    //    barulah blok di bawah ini yang memanggil GAS — dan hanya untuk
    //    ID yang benar-benar terbit.
    if (publishedIds.length > 0) {
      await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: API_SECRET,
          action: "mark_published_by_cron",
          publishedIds
        })
      });
    }

    return res.status(200).json({
      success: true,
      checkedAt: `${dateStr} ${hourPrefix}:00 WIB`,
      dueCount: dueData.duePosts.length,
      publishedCount: publishedIds.length,
      skipped,
      warning: cronCheck.configured ? undefined : "CRON_SECRET belum diset di Vercel — segera set agar endpoint ini tidak bisa dipicu sembarang orang."
    });
  } catch (err) {
    console.error("cron-publish error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
