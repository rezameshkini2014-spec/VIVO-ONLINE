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
    const subscription = req.body?.subscription;
    if (!phone) return res.status(400).json({ ok: false, error: "شماره موبایل معتبر ایران وارد کنید؛ نمونه: 09001234567" });
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ ok: false, error: "اطلاعات اشتراک اعلان این دستگاه کامل نیست." });
    }
    if (!process.env.OTP_API_KEY) return res.status(503).json({ ok: false, error: "سرویس اعلان هنوز پیکربندی نشده است." });

    const response = await fetch(API + "/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.OTP_API_KEY },
      body: JSON.stringify({ userId: "vivo-phone-" + phone, subscription })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ ok: false, error: data.error || "ثبت دستگاه ناموفق بود" });
    return res.json({ ok: true, userId: "vivo-phone-" + phone });
  } catch (error) {
    console.error("VIVO push subscription error:", error);
    return res.status(502).json({ ok: false, error: "ارتباط با سرویس اعلان برقرار نشد." });
  }
};