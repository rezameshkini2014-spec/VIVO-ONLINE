function readCookie(req, name) {
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  const header = String(req.headers.cookie || "");
  const item = header.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  if (!item) return "";
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ""; }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "Method not allowed" });

  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const route = segments.map(x => String(x)).join("/");
  if (!route || route === "session" || route === "logout" || route.includes("..")) {
    return res.status(404).json({ ok: false, error: "مسیر پیدا نشد." });
  }

  const token = readCookie(req, "vivo_session");
  if (!token) return res.status(401).json({ ok: false, error: "برای ادامه وارد حساب ویوو شوید." });

  const base = process.env.VIVO_SUPABASE_URL;
  const publishableKey = process.env.VIVO_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !publishableKey) return res.status(503).json({ ok: false, error: "سرویس ابری ویوو پیکربندی نشده است." });

  try {
    const encodedPath = segments.map(x => encodeURIComponent(String(x))).join("/");
    const headers = {
      "apikey": publishableKey,
      "authorization": "Bearer " + token,
      "accept": "application/json"
    };
    let body;
    if (req.method === "POST") {
      headers["content-type"] = "application/json";
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    }
    const upstream = await fetch(base.replace(/\/+$/, "") + "/functions/v1/vivo-api/" + encodedPath, {
      method: req.method,
      headers,
      body,
      cache: "no-store"
    });
    const payload = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return res.send(payload);
  } catch (error) {
    console.error("VIVO API proxy error:", error);
    return res.status(502).json({ ok: false, error: "ارتباط با سرویس ابری برقرار نشد." });
  }
};