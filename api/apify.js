/**
 * VERCEL SERVERLESS ENDPOINT (/api/apify)
 *
 * Menarik tren konten (TikTok / Instagram / YouTube / Threads) lewat Apify.
 * Dipakai halaman Ideas: cari konten yang sedang perform berdasarkan keyword
 * dalam N hari terakhir (7 / 14 / 30).
 *
 * MENGAPA ASYNC (START + POLL), BUKAN SEKALI JALAN:
 * Vercel Hobby membatasi durasi fungsi serverless (~10 detik, sama seperti
 * pola di api/social-sync.js yang memakai timeout guard). Satu run actor
 * Apify bisa memakan waktu menit, jadi request yang menunggu run selesai
 * pasti timeout. Karena itu endpoint ini dibagi dua:
 *
 *   1. START — POST { platform, query, days }
 *      -> menjalankan actor secara async, langsung membalas
 *         { success: true, runId, status: "RUNNING", platform, query, days }
 *      -> frontend lalu polling:
 *   2. POLL  — GET ?runId=...&days=...
 *      -> RUNNING  : { success: true, status: "RUNNING", runId }
 *      -> SUCCEEDED: { success: true, status: "SUCCEEDED", runId, platform,
 *                      count, items: [ { platform, title, author, authorUrl,
 *                      url, views, likes, comments, shares, posted_at,
 *                      thumbnail } ] } — sudah dinormalisasi + difilter
 *                      ke N hari terakhir (lihat api/apify-actors.js).
 *      -> FAILED / TIMED_OUT / ABORTED: { success: false, status, error }
 *
 *   3. HEALTH — GET tanpa runId
 *      -> { success: true, apifyConnected: boolean, platforms, daysAllowed }
 *      -> hanya boolean, TIDAK pernah membocorkan token.
 *
 * BATASAN RUANG LINGKUP — ATURAN FERRY 28 Nov 2026 14:05 WIB:
 * Endpoint ini HANYA untuk data tren/referensi PUBLIK di page Ide & Tren
 * (konten kreator lain yang sedang performing, dicari via keyword +
 * rentang hari + platform). Endpoint ini TIDAK BOLEH dipakai untuk
 * menarik data personal Ferry — followers, views, engagement, demografi,
 * atau konten akunnya sendiri. Data personal itu diambil dari API resmi
 * tiap platform yang sudah terhubung via OAuth + social-sync/GAS, dan
 * itu dikerjakan di halaman Analitik (subagent lain), BUKAN di sini.
 * Karena itu endpoint ini sengaja TIDAK punya:
 * - input profil / username / URL akun / directUrls,
 * - endpoint metrik akun, followers, atau demografi,
 * - akses apa pun ke token OAuth / GAS / sheet Ferry.
 * Satu-satunya input: { platform, query (keyword topik), days }.
 *
 * TOKEN: hanya dari Environment Variable Vercel `APIFY_API_TOKEN`.
 * - JANGAN hardcode token di file ini / di repo.
 * - Token dikirim ke Apify lewat header `Authorization: Bearer ...`
 *   (bukan query string, supaya tidak bocor ke log).
 * - Token TIDAK PERNAH di-log dan TIDAK PERNAH dikembalikan ke klien.
 * - Bila token belum diset: 503 + "Apify belum terhubung — set
 *   APIFY_API_TOKEN di Vercel".
 *
 * KONFIGURASI ACTOR: lihat api/apify-actors.js — satu file, satu baris
 * per platform. Semua ID actor di sana TERKONFIRMASI di Apify Store
 * 28 Nov 2026 (riset browser parent): TikTok clockworks/free-tiktok-scraper,
 * Instagram apify/instagram-scraper (resmi), YouTube streamers/youtube-scraper,
 * Threads futurizerush/meta-threads-scraper (komunitas).
 *
 * BIAYA: input actor minimal (RESULTS_PER_PAGE = 25), tanpa memori/CPU
 * berbayar, tanpa actor berbayar. Paket Free Apify: kredit $5,00/bulan
 * dipakai BERSAMA semua actor — bila kredit habis, endpoint membalas
 * pesan "Kredit gratis Apify habis — coba lagi bulan depan atau naikkan
 * paket" (lihat `isCreditExhausted` / `CREDIT_EXHAUSTED_MESSAGE`).
 *
 * Mengikuti pola repo yang sudah ada (api/social-sync.js, api/gas-proxy.js):
 * ESM `export default handler(req, res)`, respons selalu
 * `{ success, ... }`, body POST diterima sebagai objek atau string JSON.
 */

import {
  APIFY_ACTORS,
  PLATFORMS,
  DAYS_ALLOWED,
  DEFAULT_DAYS,
  buildActorInput,
  normalizeItems,
  platformFromActorId,
} from "./apify-actors.js";

const APIFY_API_BASE = "https://api.apify.com/v2";

const TOKEN_NOT_SET_MESSAGE =
  "Apify belum terhubung — set APIFY_API_TOKEN di Vercel";

/** Pesan bila kredit gratis Apify ($5/bulan, dipakai bersama) habis. */
const CREDIT_EXHAUSTED_MESSAGE =
  "Kredit gratis Apify habis — coba lagi bulan depan atau naikkan paket";

/**
 * Deteksi pesan kehabisan kredit dari Apify. Apify bisa membalas HTTP 402
 * (Payment Required) atau pesan seperti "insufficient credit", "out of
 * credit", "not enough credit", "usage limit reached". Pesan yang
 * diteruskan ke klien selalu CREDIT_EXHAUSTED_MESSAGE — tanpa detail
 * akun/tagihan dan tanpa token.
 */
function isCreditExhausted(message, status) {
  if (status === 402) return true;
  if (typeof message !== "string" || !message) return false;
  return /insufficient credit|out of credit|not enough credit|credit (limit|exhausted|depleted)|usage limit|monthly (credit|usage|limit)|credit balance/i.test(
    message
  );
}

/** fetch dengan timeout, pola yang sama dengan api/social-sync.js. */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Panggil Apify API. Token hanya lewat header Authorization.
 * Mengembalikan JSON hasil. Bila Apify error, throw Error dengan pesan
 * Apify (tanpa token). Bila respons bukan JSON, throw Error yang jelas.
 */
async function apifyFetch(token, path, { method = "GET", body, timeoutMs = 8000 } = {}) {
  let res;
  try {
    res = await fetchWithTimeout(`${APIFY_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs);
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("Permintaan ke Apify timeout. Coba lagi.");
    }
    throw new Error(`Gagal menghubungi Apify: ${e.message}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    throw new Error(`Apify mengembalikan respons bukan JSON (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const apifyMessage =
      (data && data.error && (data.error.message || data.error.type)) ||
      (data && data.message) ||
      `Apify error (HTTP ${res.status})`;
    const err = new Error(String(apifyMessage));
    err.status = res.status;
    if (isCreditExhausted(apifyMessage, res.status)) {
      err.code = "CREDIT_EXHAUSTED";
    }
    throw err;
  }

  return data;
}

/** Parse body POST: Vercel bisa memberi objek atau string JSON. */
function parseBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return null; // ditandai invalid oleh pemanggil
    }
  }
  if (req.body && typeof req.body === "object") return req.body;
  return {};
}

function validDays(value) {
  const n = Number(value);
  return DAYS_ALLOWED.includes(n) ? n : null;
}

export default async function handler(req, res) {
  const token = process.env.APIFY_API_TOKEN;

  try {
    // ---------------------------------------------------------------
    // GET
    // ---------------------------------------------------------------
    if (req.method === "GET") {
      const runId = req.query && req.query.runId;

      // Health check — tanpa runId. Hanya boolean, tanpa bocor token.
      if (!runId) {
        return res.status(200).json({
          success: true,
          apifyConnected: Boolean(token),
          platforms: PLATFORMS,
          daysAllowed: DAYS_ALLOWED,
        });
      }

      // Poll butuh token.
      if (!token) {
        return res.status(503).json({ success: false, error: TOKEN_NOT_SET_MESSAGE });
      }

      const days = validDays(req.query.days) ?? DEFAULT_DAYS;

      let run;
      try {
        run = await apifyFetch(token, `/actor-runs/${encodeURIComponent(String(runId))}`);
      } catch (e) {
        if (e.code === "CREDIT_EXHAUSTED") {
          return res.status(502).json({ success: false, error: CREDIT_EXHAUSTED_MESSAGE });
        }
        const status = e.status === 404 ? 404 : 502;
        return res.status(status).json({
          success: false,
          error:
            e.status === 404
              ? `Run tidak ditemukan: ${runId}`
              : `Gagal memeriksa status run: ${e.message}`,
        });
      }

      const runData = run && run.data ? run.data : run;
      const status = runData.status;

      // Masih jalan — frontend lanjut polling.
      if (status === "RUNNING" || status === "READY") {
        return res.status(200).json({ success: true, status: "RUNNING", runId: String(runId) });
      }

      // Gagal / timeout / dibatalkan — sampaikan apa adanya.
      if (status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") {
        return res.status(502).json({
          success: false,
          status,
          runId: String(runId),
          error: `Run Apify ${status.toLowerCase().replace("-", " ")}. Coba lagi dengan keyword lain atau periksa actor di Apify Console.`,
        });
      }

      // Selesai — ambil dataset items, normalisasi + filter N hari terakhir.
      if (status === "SUCCEEDED") {
        const datasetId = runData.defaultDatasetId;
        if (!datasetId) {
          return res.status(502).json({
            success: false,
            status,
            runId: String(runId),
            error: "Run selesai tapi tidak ada dataset. Periksa actor di Apify Console.",
          });
        }

        const platform =
          platformFromActorId(runData.actId) ||
          (typeof req.query.platform === "string" && PLATFORMS.includes(req.query.platform)
            ? req.query.platform
            : "tiktok");

        let rawItems = [];
        try {
          const itemsRes = await apifyFetch(
            token,
            `/actor-runs/${encodeURIComponent(String(runId))}/dataset/items?limit=100&clean=true`,
            { timeoutMs: 8000 }
          );
          rawItems = Array.isArray(itemsRes) ? itemsRes : itemsRes.data || [];
        } catch (e) {
          if (e.code === "CREDIT_EXHAUSTED") {
            return res.status(502).json({
              success: false,
              status,
              runId: String(runId),
              error: CREDIT_EXHAUSTED_MESSAGE,
            });
          }
          return res.status(502).json({
            success: false,
            status,
            runId: String(runId),
            error: `Run selesai tapi gagal mengambil hasil: ${e.message}`,
          });
        }

        const items = normalizeItems(platform, rawItems, days);
        return res.status(200).json({
          success: true,
          status: "SUCCEEDED",
          runId: String(runId),
          platform,
          days,
          count: items.length,
          items,
        });
      }

      // Status lain yang tak dikenal dari Apify.
      return res.status(502).json({
        success: false,
        status: status || "UNKNOWN",
        runId: String(runId),
        error: `Status run Apify tidak dikenal: ${status || "UNKNOWN"}.`,
      });
    }

    // ---------------------------------------------------------------
    // POST — start run (async)
    // ---------------------------------------------------------------
    if (req.method === "POST") {
      if (!token) {
        return res.status(503).json({ success: false, error: TOKEN_NOT_SET_MESSAGE });
      }

      const body = parseBody(req);
      if (body === null) {
        return res.status(400).json({ success: false, error: "Body JSON tidak valid." });
      }

      const platform =
        typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
      if (!PLATFORMS.includes(platform)) {
        return res.status(400).json({
          success: false,
          error: `Platform tidak dikenal: "${body.platform || ""}". Pilih salah satu: ${PLATFORMS.join(", ")}.`,
        });
      }

      const query =
        typeof body.query === "string"
          ? body.query.trim()
          : typeof body.keyword === "string"
            ? body.keyword.trim()
            : "";
      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Keyword/query wajib diisi.",
        });
      }

      const days =
        body.days === undefined || body.days === null
          ? DEFAULT_DAYS
          : validDays(body.days);
      if (days === null) {
        return res.status(400).json({
          success: false,
          error: `days tidak valid: "${body.days}". Pilih salah satu: ${DAYS_ALLOWED.join(", ")}.`,
        });
      }

      const cfg = APIFY_ACTORS[platform];
      const input = buildActorInput(platform, query, days);

      let started;
      try {
        started = await apifyFetch(token, `/acts/${encodeURIComponent(cfg.actorId)}/runs`, {
          method: "POST",
          body: input,
        });
      } catch (e) {
        // Kredit gratis habis — pesan jelas, tanpa detail akun/tagihan.
        if (e.code === "CREDIT_EXHAUSTED") {
          return res.status(502).json({
            success: false,
            error: CREDIT_EXHAUSTED_MESSAGE,
          });
        }
        // 404 dari Apify besar kemungkinan actorId salah —
        // sampaikan itu supaya tidak dikira token yang bermasalah.
        if (e.status === 404) {
          return res.status(502).json({
            success: false,
            error:
              `Actor Apify tidak ditemukan: ${cfg.actorId}. ` +
              `Periksa ID actor di Apify Store lalu ubah satu baris actorId ` +
              `di api/apify-actors.js. ` +
              `Detail Apify: ${e.message}`,
          });
        }
        return res.status(502).json({
          success: false,
          error: `Gagal menjalankan actor Apify: ${e.message}`,
        });
      }

      const runData = started && started.data ? started.data : started;
      const runId = runData.id;
      if (!runId) {
        return res.status(502).json({
          success: false,
          error: "Apify tidak mengembalikan runId. Coba lagi.",
        });
      }

      return res.status(200).json({
        success: true,
        runId,
        status: "RUNNING",
        platform,
        query,
        days,
      });
    }

    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  } catch (err) {
    console.error("apify error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
