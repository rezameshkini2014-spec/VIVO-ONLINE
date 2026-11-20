module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  return res.status(503).json({
    ok: false,
    error: "سامانه اعلان ورود تا راه‌اندازی احراز هویت امن موقتاً غیرفعال است."
  });
};
