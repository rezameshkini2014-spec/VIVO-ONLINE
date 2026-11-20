function normalizePhone(value) {
  const digits = String(value || "")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const national = digits.replace(/[\s()-]/g, "").replace(/^\+?98/, "0");
  return /^09\d{9}$/.test(national) ? national : null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  return res.status(503).json({
    ok: false,
    error: "ورود و ثبت‌نام موقتاً غیرفعال است؛ کد اعلان دستگاه مالکیت شماره تلفن را اثبات نمی‌کند."
  });
  const phone = normalizePhone(req.body?.phone);
  const name = String(req.body?.name || "").trim().slice(0, 50);
  const username = String(req.body?.username || "").trim().toLowerCase();
  const requestId = String(req.body?.requestId || "").trim();
  const code = String(req.body?.code || "")
    .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!phone || name.length < 2 || !/^[a-z][a-z0-9_]{3,29}$/.test(username)) return res.status(400).json({ ok: false, error: "شماره موبایل، نام نمایشی یا نام کاربری معتبر نیست." });
  if (!requestId || requestId.length > 200 || !/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: "کد تأیید یا شناسه درخواست معتبر نیست." });

  const otpApiKey = process.env.OTP_API_KEY;
  if (!otpApiKey) return res.status(503).json({ ok: false, error: "سرویس تأیید شماره هنوز پیکربندی نشده است." });

  try {
    const otpResponse = await fetch("https://otp-push-server.vercel.app/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": otpApiKey },
      body: JSON.stringify({ userId: "vivo-phone-" + phone, requestId, code })
    });
    const otpData = await otpResponse.json().catch(() => ({}));
    if (!otpResponse.ok) {
      return res.status(otpResponse.status >= 400 && otpResponse.status < 500 ? otpResponse.status : 502)
        .json({ ok: false, error: otpData.error || "کد تأیید معتبر نیست یا مهلت آن پایان یافته است." });
    }
  } catch (error) {
    console.error("VIVO OTP verification error:", error);
    return res.status(502).json({ ok: false, error: "ارتباط با سرویس تأیید شماره برقرار نشد." });
  }

  const base = process.env.VIVO_SUPABASE_URL;
  const publishableKey = process.env.VIVO_SUPABASE_PUBLISHABLE_KEY;
  const internalSecret = process.env.VIVO_BACKEND_SECRET;
  if (!base || !publishableKey || !internalSecret) {
    return res.status(503).json({ ok: false, error: "اتصال امن حساب ویوو هنوز کامل پیکربندی نشده است." });
  }

  try {
    const response = await fetch(base.replace(/\/+$/, "") + "/functions/v1/vivo-api/auth/issue", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": publishableKey,
        "x-vivo-internal-secret": internalSecret
      },
      body: JSON.stringify({ phone, name, username })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.sessionToken || !data.user) {
      return res.status(response.status || 502).json({ ok: false, error: data.error || "ساخت نشست امن انجام نشد." });
    }
    const cookie = "vivo_session=" + encodeURIComponent(data.sessionToken) +
      "; HttpOnly; Secure; SameSite=Lax; Path=/api/vivo; Max-Age=2592000";
    res.setHeader("Set-Cookie", cookie);
    return res.status(200).json({ ok: true, user: data.user });
  } catch (error) {
    console.error("VIVO session issue error:", error);
    return res.status(502).json({ ok: false, error: "ارتباط امن با سرویس حساب برقرار نشد." });
  }
};