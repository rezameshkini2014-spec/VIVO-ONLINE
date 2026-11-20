module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  return res.status(503).json({
    ok: false,
    error: "ورود و ثبت‌نام تا اتصال احراز هویت واقعی و امن موقتاً غیرفعال است."
  });
};
