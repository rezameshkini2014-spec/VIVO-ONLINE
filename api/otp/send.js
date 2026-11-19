const API = "https://otp-push-server.vercel.app";

function normalizeIranMobile(value) {
  const digits = String(value || "")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const compact = digits.replace(/[\s()-]/g, "");
  const national = compact.replace(/^\+?98/, "0");
  return /^09\d{9}$/.test(national) ? national : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    const phone = normalizeIranMobile(req.body?.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "شماره موبایل معتبر ایران وارد کنید؛ نمونه: 09001234567" });
    if (!process.env.OTP_API_KEY) return res.status(503).json({ ok: false, error: "سرویس ارسال کد هنوز پیکربندی نشده است." });

    const response = await fetch(API + "/api/send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.OTP_API_KEY },
      body: JSON.stringify({ userId: "vivo-phone-" + phone, purpose: "ورود به پیام‌رسان ویوو" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ ok: false, error: data.error || "ارسال اعلان ناموفق بود" });
    if (!data.requestId) return res.status(502).json({ ok: false, error: "سرویس اعلان شناسه درخواست معتبر برنگرداند." });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, requestId: data.requestId, expiresIn: data.expiresIn || 120 });
  } catch (error) {
    console.error("VIVO OTP send error:", error);
    return res.status(502).json({ ok: false, error: "ارتباط با سرویس ارسال اعلان برقرار نشد." });
  }
};