module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(503).json({
    ok: false,
    error: "سرویس حساب و داده‌های شخصی ویوو تا تکمیل احراز هویت امن موقتاً غیرفعال است."
  });
};
