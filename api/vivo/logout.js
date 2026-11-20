module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  res.setHeader("Set-Cookie", "vivo_session=; HttpOnly; Secure; SameSite=Lax; Path=/api/vivo; Max-Age=0");
  return res.status(200).json({ ok: true });
};