/**
 * VERCEL SERVERLESS PROXY (/api/gas-proxy)
 * Menjembatani frontend Vercel dengan Google Apps Script secara aman
 * menggunakan Environment Variables (GAS_WEB_APP_URL & GAS_API_SECRET).
 */

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
      const targetUrl = `${GAS_URL}?api=${encodeURIComponent(endpoint)}&secret=${encodeURIComponent(API_SECRET)}`;
      const gasRes = await fetch(targetUrl, { redirect: "follow" });
      const data = await gasRes.json();
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const payload = {
        ...req.body,
        secret: API_SECRET
      };
      const gasRes = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow"
      });
      const data = await gasRes.json();
      return res.status(200).json(data);
    }

    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}