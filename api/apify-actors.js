/**
 * APIFY ACTOR CONFIG — ContentPlan (/api/apify)
 *
 * SATU file ini adalah satu-satunya tempat konfigurasi actor Apify.
 * Mengganti actor untuk satu platform = ubah SATU baris `actorId` di bawah.
 *
 * RUANG LINGKUP (aturan Ferry 28 Nov 2026 14:05 WIB):
 * Konfigurasi di file ini HANYA untuk pencarian tren PUBLIK berdasarkan
 * keyword topik + rentang hari + platform (page Ide & Tren). TIDAK ADA
 * input profil/username/URL akun/directUrls di sini — data personal Ferry
 * (followers, views, engagement, demografi, konten akunnya sendiri)
 * diambil dari API resmi tiap platform via OAuth + social-sync/GAS
 * (halaman Analitik, subagent lain), BUKAN lewat Apify.
 *
 * ✅ STATUS: SEMUA ID DI BAWAH INI TERKONFIRMASI di Apify Store,
 * 28 Nov 2026 (riset browser parent; akun Ferry "friz",
 * ferrydwn25@gmail.com, paket Free). Bukan lagi provisional.
 * Detail harga/batasan per actor: lihat APIFY-NOTES.md §3.
 *
 * ATURAN BIAYA — PENTING:
 * - Paket Free Apify memberi kredit $5,00/bulan yang dipakai BERSAMA
 *   semua actor — TIDAK ADA actor yang unlimited gratis. Setiap hasil
 *   yang ditarik memotong kredit bersama itu.
 * - Karena itu input actor dibuat minimal: hanya keyword + jumlah hasil
 *   (RESULTS_PER_PAGE = 25, dalam rentang hemat 20–30 per panggilan).
 * - Jangan pakai actor berbayar / paid actor.
 * - Jangan set memori/CPU berbayar (tidak ada `memoryMbytes` di input).
 * - Jangan tarik komentar (scrapeComments: false di Threads; Instagram
 *   dibatasi ~15 komentar/post di paket gratis — tidak dipakai sama
 *   sekali di sini karena yang dibutuhkan hanya metrik tren).
 *
 * FILTER WAKTU (days 7/14/30):
 * - Filter tanggal dipetakan ke input asli tiap actor BILA actor itu
 *   punya field tanggal, DAN tetap ada cutoff di normalisasi sebagai
 *   fallback (lihat `normalizeItem()`):
 *   - TikTok (clockworks/free-tiktok-scraper): TIDAK punya filter
 *     tanggal di input -> hanya cutoff normalisasi.
 *   - Instagram (apify/instagram-scraper): `onlyPostsNewerThan`
 *     = tanggal cutoff (YYYY-MM-DD).
 *   - YouTube (streamers/youtube-scraper): `oldestPostDate`
 *     = tanggal cutoff (YYYY-MM-DD). Actor ini juga menerima
 *     `dateFilter` ("today" / "this week" / "this month" / "this year"),
 *     tapi itu terlalu kasar untuk 7/14/30, jadi `oldestPostDate`
 *     yang dipakai (presisi hari). TIDAK ADA input "trending" native —
 *     tren didapat dari search query / startUrl trending YouTube.
 *   - Threads (futurizerush/meta-threads-scraper): `dateFilter`
 *     = pemetaan kasar via `dateFilterForDays()` (7 -> "this week",
 *     14/30 -> "this month") + cutoff normalisasi sebagai fallback
 *     yang presisi.
 * - `normalizeItem()` membuang item yang `posted_at`-nya lebih tua
 *   dari cutoff (sekarang − days). Item tanpa tanggal yang bisa
 *   diparse juga dibuang saat cutoff aktif, supaya tidak ada item tua
 *   yang lolos tanpa tanggal.
 *
 * FIELD YANG TIDAK TERSEDIA PER PLATFORM (hasil normalisasi):
 * - Instagram: TIDAK ADA field shares -> `shares: null` (bukan 0,
 *   supaya frontend bisa membedakan "tidak ada data" dari "0 share").
 *   Views hanya ada untuk video/reel (`videoViewCount` /
 *   `videoPlayCount`); post foto tanpa field views -> `views: 0`.
 *   Komentar di paket gratis dibatasi ~1 halaman (~15) per post.
 * - YouTube: TIDAK ADA field shares -> `shares: null`.
 * - TikTok: semua metrik ada (`playCount`, `diggCount`,
 *   `commentCount`, `shareCount`, plus `collectCount` yang tidak
 *   dipakai format tren standar).
 * - Threads: semua metrik ada (`likesCount`, `repliesCount`,
 *   `repostsCount`, `sharesCount`, `viewsCount`).
 */

export const PLATFORMS = ["tiktok", "instagram", "youtube", "threads"];

export const DAYS_ALLOWED = [7, 14, 30];

export const DEFAULT_DAYS = 14;

/** Jumlah hasil per run — secukupnya (20–30) agar hemat kredit $5/bulan bersama. */
export const RESULTS_PER_PAGE = 25;

/** Tanggal cutoff (YYYY-MM-DD) untuk `days` hari terakhir. */
function cutoffDate(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Pemetaan kasar days -> `dateFilter` actor (YouTube/Threads).
 * 7 hari -> "this week"; 14/30 hari -> "this month". Dipakai Threads;
 * YouTube memakai `oldestPostDate` yang presisi (lihat di bawah).
 */
export function dateFilterForDays(days) {
  if (days <= 7) return "this week";
  return "this month";
}

export const APIFY_ACTORS = {
  tiktok: {
    actorId: "clockworks/free-tiktok-scraper",
    displayName: "TikTok Data Extractor",
    author: "clockworks",
    official: false,
    provisional: false,
    pricePer1000: 3.0,
    monthlyBudgetResults: 1600,
    note:
      "TERKONFIRMASI di Apify Store 28 Nov 2026. $3,00/1.000 hasil " +
      "(~1.600 hasil/bulan dari kredit $5 bersama). Input: searchQueries " +
      "+ resultsPerPage. TIDAK punya filter tanggal di input — filter " +
      "waktu hanya via cutoff normalisasi.",
    buildInput: (query, _days) => ({
      searchQueries: [query],
      resultsPerPage: RESULTS_PER_PAGE,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
    }),
  },

  instagram: {
    actorId: "apify/instagram-scraper",
    displayName: "Instagram Scraper",
    author: "apify",
    official: true,
    provisional: false,
    pricePer1000: 2.7,
    monthlyBudgetResults: 1850,
    note:
      "TERKONFIRMASI di Apify Store 28 Nov 2026 — actor RESMI Apify. " +
      "$2,70/1.000 hasil (~1.850/bulan dari kredit $5 bersama). " +
      "Selalu mode hashtag/topik, JANGAN mode user/akun/profil dan " +
      "JANGAN directUrls ke profil (aturan Ferry 14:05 WIB). " +
      "Tidak ada field shares. Komentar gratis dibatasi ~15/post.",
    buildInput: (query, days) => ({
      // Selalu hashtag: query di sini adalah TOPIK tren publik, bukan nama
      // akun. Endpoint ini tidak menerima input profil/username/akun —
      // sesuai aturan Ferry 28 Nov 2026 14:05 WIB, Apify HANYA untuk
      // tren/referensi publik, bukan data akun (lihat api/apify.js).
      search: query,
      searchType: "hashtag",
      resultsType: "posts",
      resultsLimit: RESULTS_PER_PAGE,
      onlyPostsNewerThan: cutoffDate(days),
    }),
  },

  youtube: {
    actorId: "streamers/youtube-scraper",
    displayName: "YouTube Scraper",
    author: "streamers",
    official: false,
    provisional: false,
    pricePer1000: 4.0,
    monthlyBudgetResults: 1250,
    note:
      "TERKONFIRMASI di Apify Store 28 Nov 2026. $4,00/1.000 video " +
      "(~1.250/bulan dari kredit $5 bersama) — paling mahal dari keempatnya. " +
      "Tidak ada input 'trending' native — tren dari search query / " +
      "startUrl trending/search YouTube. Tidak ada field shares.",
    buildInput: (query, days) => ({
      searchQueries: [query],
      maxResults: RESULTS_PER_PAGE,
      // Filter tanggal upload yang presisi (YYYY-MM-DD). Actor ini juga
      // menerima dateFilter ("today"/"this week"/"this month"/"this year")
      // tapi terlalu kasar untuk 7/14/30; bila actor menolak
      // oldestPostDate, filter cutoff di normalizeItem() tetap berlaku.
      oldestPostDate: cutoffDate(days),
    }),
  },

  threads: {
    actorId: "futurizerush/meta-threads-scraper",
    displayName: "Threads Scraper",
    author: "futurizerush",
    official: false,
    provisional: false,
    pricePer1000: 2.5,
    pricePerStart: 0.02,
    monthlyBudgetResults: 2000,
    note:
      "TERKONFIRMASI di Apify Store 28 Nov 2026 — actor KOMUNITAS " +
      "Futurize Rush, BUKAN resmi Apify. $2,50/1.000 hasil + $0,02 per " +
      "start (~2.000/bulan dari kredit $5 bersama). TIDAK ADA actor " +
      "Threads resmi untuk post/search — Apify hanya punya " +
      "apify/threads-profile-api-scraper (profil saja, tidak dipakai " +
      "di sini karena aturan Ferry: tren publik, bukan data akun).",
    buildInput: (query, days) => ({
      searchTerms: [query],
      searchType: "top",
      maxPosts: RESULTS_PER_PAGE,
      dateFilter: dateFilterForDays(days),
      scrapeComments: false,
      maxReplies: 0,
    }),
  },
};

/** Cari nama platform dari actorId (untuk memetakan run -> platform saat polling). */
export function platformFromActorId(actorId) {
  for (const [platform, cfg] of Object.entries(APIFY_ACTORS)) {
    if (cfg.actorId === actorId) return platform;
  }
  return null;
}

/** Bangun input actor untuk satu platform. Satu tempat, mudah diubah. */
export function buildActorInput(platform, query, days) {
  const cfg = APIFY_ACTORS[platform];
  if (!cfg) throw new Error(`Platform tidak dikenal: ${platform}`);
  return cfg.buildInput(query, days);
}

// ---------------------------------------------------------------------------
// Normalisasi — semua platform -> satu bentuk tren:
// { platform, title, author, authorUrl, url, views, likes, comments,
//   shares, posted_at, thumbnail }
// `shares` = null bila platform tidak punya field shares (Instagram,
// YouTube) — lihat header file. Field lain yang tak ada -> 0 / "".
// ---------------------------------------------------------------------------

/** Ambil nilai pertama yang terdefinisi dari daftar kandidat key (mendukung path "a.b"). */
function pick(raw, candidates) {
  for (const key of candidates) {
    const value = key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), raw);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Ubah angka / string angka ("1.2K", "3,4 jt", "12.5K") menjadi number. */
export function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return 0;
  const s = value.trim().replace(/,/g, ".");
  const m = s.match(/^([\d.]+)\s*([kKmMjJ]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") n *= 1_000;
  else if (suffix === "m") n *= 1_000_000;
  else if (suffix === "j") n *= 1_000_000; // "jt" (juta) — awalan "j"
  return Math.round(n);
}

/**
 * Ubah berbagai bentuk tanggal actor menjadi ISO string (atau null bila
 * tidak bisa diparse). Mendukung: ISO string, unix detik/ms, dan string
 * relatif sederhana ("2 hours ago", "3 days ago", "5 jam lalu", "2 hari lalu").
 */
export function parsePostedAt(value, nowMs = Date.now()) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    // Unix detik (< 1e12) atau milidetik.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof value === "string") {
    const s = value.trim();
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();

    // Relatif: "X hours/days/minutes ago" atau "X jam/hari/menit lalu".
    const m = s.match(/^(\d+)\s*(second|minute|hour|day|week|detik|menit|jam|hari|minggu)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const unitMs =
        unit.startsWith("second") || unit.startsWith("detik") ? 1000 :
        unit.startsWith("minute") || unit.startsWith("menit") ? 60 * 1000 :
        unit.startsWith("hour") || unit.startsWith("jam") ? 3600 * 1000 :
        unit.startsWith("week") || unit.startsWith("minggu") ? 7 * 24 * 3600 * 1000 :
        24 * 3600 * 1000; // day / hari
      return new Date(nowMs - n * unitMs).toISOString();
    }
  }

  return null;
}

/** Platform yang TIDAK punya field shares di output actor-nya. */
export const PLATFORMS_WITHOUT_SHARES = ["instagram", "youtube"];

/**
 * Normalisasi satu item mentah actor menjadi bentuk tren standar.
 * Mengembalikan null bila item tidak punya URL/judul yang bisa dipakai,
 * ATAU bila posted_at-nya lebih tua dari cutoffMs (filter N hari terakhir).
 * `cutoffMs` boleh null = tanpa filter tanggal.
 */
export function normalizeItem(platform, raw, cutoffMs = null) {
  if (!raw || typeof raw !== "object") return null;

  const postedAt = parsePostedAt(
    pick(raw, [
      // TikTok clockworks: createTimeISO (ISO) / createTime (unix).
      "createTimeISO",
      "createTime",
      // Instagram / Threads: timestamp (ISO atau unix).
      "timestamp",
      // YouTube streamers: date (ISO / "YYYY-MM-DD" / relatif).
      "date",
      "publishedAt",
      "createdAt",
      "taken_at_timestamp",
      "videoMeta.createTime",
    ])
  );

  // Filter waktu: buang item lebih tua dari N hari terakhir.
  if (cutoffMs !== null && cutoffMs !== undefined) {
    if (!postedAt) return null; // tanpa tanggal -> tidak bisa dipastikan masih dalam rentang
    if (new Date(postedAt).getTime() < cutoffMs) return null;
  }

  const title = pick(raw, [
    "title", // YouTube streamers (judul; "text"-nya adalah deskripsi!)
    "desc", // TikTok clockworks (deskripsi video)
    "caption", // Instagram (string caption)
    "text", // Threads (isi post; di YouTube ini deskripsi, jadi terakhir)
    "videoMeta.title",
    "snippet.title",
  ]);
  const url = pick(raw, [
    "url",
    "webVideoUrl", // TikTok clockworks
    "permalink",
    "videoUrl", // Instagram
    "postUrl",
    "id", // fallback terakhir di bawah (dibangun per platform bila perlu)
  ]);

  // Tanpa judul DAN tanpa URL yang jelas, item tidak berguna untuk feed tren.
  if (!title && !url) return null;

  const author = pick(raw, [
    "authorMeta.nickname", // TikTok clockworks (huruf kecil)
    "authorMeta.nickName",
    "authorMeta.name",
    "author.nickname",
    "author.username",
    "author",
    "ownerUsername", // Instagram
    "ownerFullName", // Instagram
    "channelName", // YouTube streamers
    "channelTitle",
    "username", // Threads
    "user.username",
  ]);
  const authorUrl = pick(raw, [
    "authorMeta.profileUrl",
    "author.profileUrl",
    "authorUrl",
    "ownerProfileUrl",
    "channelUrl", // YouTube streamers
  ]);
  const thumbnail = pick(raw, [
    "covers.default",
    "covers.origin",
    "videoMeta.coverUrl", // TikTok clockworks
    "displayUrl", // Instagram (thumbnail post)
    "thumbnailUrl", // YouTube streamers / Threads
    "thumbnail",
    "thumbnails.high.url",
    "thumbnails.default.url",
    "media_url",
    "image",
  ]);

  const views = toNumber(
    pick(raw, [
      "playCount", // TikTok clockworks
      "viewCount", // YouTube streamers
      "viewsCount", // Threads
      "videoViewCount", // Instagram (video/reel)
      "videoPlayCount", // Instagram (video/reel, alias)
      "views",
      "videoMeta.playCount",
      "statistics.viewCount",
    ])
  );
  const likes = toNumber(
    pick(raw, [
      "diggCount", // TikTok clockworks
      "likesCount", // Instagram / Threads
      "likes", // YouTube streamers (field-nya "likes", bukan likesCount)
      "likeCount",
      "statistics.likeCount",
    ])
  );
  const comments = toNumber(
    pick(raw, [
      "commentCount", // TikTok clockworks
      "commentsCount", // Instagram / YouTube streamers
      "repliesCount", // Threads (balasan = komentar)
      "comments",
      "numberOfComments",
      "statistics.commentCount",
    ])
  );
  // Shares: Instagram & YouTube TIDAK punya field shares -> null.
  // TikTok: shareCount. Threads: sharesCount, bila tak ada -> repostsCount.
  const shares = PLATFORMS_WITHOUT_SHARES.includes(platform)
    ? null
    : toNumber(pick(raw, ["sharesCount", "shareCount", "repostsCount", "shares", "statistics.shareCount"]));

  // Fallback URL dari id mentah bila actor hanya memberi id.
  let finalUrl = typeof url === "string" ? url : "";
  if (!finalUrl && typeof raw.id === "string" && raw.id) {
    if (platform === "youtube") finalUrl = `https://www.youtube.com/watch?v=${raw.id}`;
    else if (platform === "tiktok") finalUrl = `https://www.tiktok.com/@${author || "user"}/video/${raw.id}`;
    else if (platform === "instagram") finalUrl = `https://www.instagram.com/p/${raw.id}/`;
  }

  return {
    platform,
    title: typeof title === "string" ? title.slice(0, 200) : "",
    author: typeof author === "string" ? author : "",
    authorUrl: typeof authorUrl === "string" ? authorUrl : "",
    url: finalUrl,
    views,
    likes,
    comments,
    shares,
    posted_at: postedAt || "",
    thumbnail: typeof thumbnail === "string" ? thumbnail : "",
  };
}

/** Normalisasi + filter + urutkan (paling banyak engagement dulu). */
export function normalizeItems(platform, items, days) {
  const cutoffMs =
    typeof days === "number" ? Date.now() - days * 24 * 3600 * 1000 : null;
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const n = normalizeItem(platform, raw, cutoffMs);
    if (n) out.push(n);
  }
  out.sort((a, b) => b.views + b.likes + b.comments - (a.views + a.likes + a.comments));
  return out;
}
