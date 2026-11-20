import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vivo-internal-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function b64url(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value: string) {
  const raw = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - raw.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function hexBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Invalid internal configuration");
  return Uint8Array.from(value.match(/.{2}/g)!, x => parseInt(x, 16));
}
async function getSessionKey() {
  const material = await crypto.subtle.importKey("raw", encoder.encode(SERVICE_KEY), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("vivo-session-key-v2"), info: encoder.encode("vivo-api/session-token-signing") },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
}
async function digestHex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map(x => x.toString(16).padStart(2, "0")).join("");
}
function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
async function issueToken(userId: string, key: CryptoKey) {
  const payload = b64url(encoder.encode(JSON.stringify({ sub: userId, iat: Date.now(), exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return payload + "." + b64url(signature);
}
async function authenticate(req: Request, key: CryptoKey) {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const signature = fromB64url(parts[1]);
    const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (typeof payload.sub !== "string" || !payload.sub || Number(payload.exp) < Date.now()) return null;
    return payload.sub as string;
  } catch {
    return null;
  }
}
function validPhone(value: unknown): value is string {
  return typeof value === "string" && /^09\d{9}$/.test(value);
}
function dateValue(value: unknown) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString();
  const d = new Date(String(value || ""));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function safeText(value: unknown, max: number) {
  return String(value ?? "").slice(0, max);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/vivo-api/, "").replace(/^\/vivo-api/, "") || "/";
  try {
    const key = await getSessionKey();

    if (path === "/health" && req.method === "GET") {
      return json(200, { ok: true, service: "VIVO Cloud API", version: "1.0.0" });
    }

    if (path === "/auth/issue" && req.method === "POST") {
      const supplied = req.headers.get("x-vivo-internal-secret") || "";
      const { data: config, error: configError } = await supabase.from("vivo_config").select("value").eq("key", "internal_secret_hash").single();
      if (configError || !config?.value || !constantEqual(await digestHex(supplied), config.value)) {
        return json(401, { ok: false, error: "Unauthorized internal request" });
      }
      const body = await req.json().catch(() => ({}));
      const phone = body.phone;
      const name = safeText(body.name, 50).trim();
      if (!validPhone(phone) || name.length < 2) return json(400, { ok: false, error: "شماره یا نام معتبر نیست." });
      const { data: user, error } = await supabase.from("vivo_users")
        .upsert({ phone, display_name: name, updated_at: new Date().toISOString() }, { onConflict: "phone" })
        .select("id,phone,display_name,username,bio,avatar_url,created_at")
        .single();
      if (error || !user) return json(500, { ok: false, error: "ساخت حساب ابری انجام نشد." });
      return json(200, { ok: true, user, sessionToken: await issueToken(user.id, key) });
    }

    const userId = await authenticate(req, key);
    if (!userId) return json(401, { ok: false, error: "نشست معتبر نیست؛ دوباره وارد شوید." });

    if (path === "/profile" && req.method === "GET") {
      const { data, error } = await supabase.from("vivo_users")
        .select("id,phone,display_name,username,bio,avatar_url,created_at")
        .eq("id", userId).single();
      if (error || !data) return json(404, { ok: false, error: "حساب پیدا نشد." });
      return json(200, { ok: true, user: data });
    }

    if (path === "/profile" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") update.display_name = body.name.trim().slice(0, 50);
      if (typeof body.username === "string") update.username = body.username.trim().toLowerCase() || null;
      if (typeof body.bio === "string") update.bio = body.bio.slice(0, 500);
      if (typeof body.avatarUrl === "string") update.avatar_url = body.avatarUrl.slice(0, 2048);
      const { data, error } = await supabase.from("vivo_users")
        .update(update).eq("id", userId)
        .select("id,phone,display_name,username,bio,avatar_url,created_at").single();
      if (error || !data) return json(400, { ok: false, error: "ذخیره پروفایل انجام نشد؛ شناسه کاربری را بررسی کنید." });
      return json(200, { ok: true, user: data });
    }

    if (path === "/sync" && req.method === "GET") {
      const { data: chats, error: chatError } = await supabase.from("vivo_chats")
        .select("id,client_id,name,chat_type,description,pinned,photo,contact,created_at")
        .eq("owner_id", userId).order("updated_at", { ascending: false });
      if (chatError) return json(500, { ok: false, error: "دریافت گفتگوها ناموفق بود." });
      const ids = (chats || []).map(c => c.id);
      let messages: any[] = [];
      if (ids.length) {
        const { data, error } = await supabase.from("vivo_messages")
          .select("chat_id,client_id,sender_type,body,attachment,reply_to,sent_at")
          .in("chat_id", ids).order("sent_at", { ascending: true }).limit(10000);
        if (error) return json(500, { ok: false, error: "دریافت پیام‌ها ناموفق بود." });
        messages = data || [];
      }
      const result = (chats || []).map(c => ({
        id: c.client_id,
        name: c.name,
        type: c.chat_type,
        description: c.description,
        pinned: c.pinned,
        photo: c.photo,
        contact: c.contact,
        createdAt: new Date(c.created_at).getTime(),
        messages: messages.filter(m => m.chat_id === c.id).map(m => ({
          id: m.client_id,
          from: m.sender_type === "other" ? "other" : m.sender_type === "bot" ? "bot" : m.sender_type === "system" ? "system" : "me",
          text: m.body,
          attachment: m.attachment,
          replyTo: m.reply_to,
          at: new Date(m.sent_at).getTime()
        }))
      }));
      return json(200, { ok: true, chats: result });
    }

    if (path === "/sync" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!Array.isArray(body.chats) || body.chats.length > 100) return json(400, { ok: false, error: "ساختار همگام‌سازی معتبر نیست." });
      let totalMessages = 0;
      for (const c of body.chats) {
        if (!c || typeof c.id !== "string" || !c.id || typeof c.name !== "string") continue;
        const type = ["private","group","channel","saved","bot"].includes(c.type) ? c.type : "private";
        const chatRow = {
          owner_id: userId,
          client_id: c.id.slice(0, 120),
          name: c.name.trim().slice(0, 120) || "گفتگو",
          chat_type: type,
          description: safeText(c.description, 500),
          pinned: c.pinned === true,
          photo: typeof c.photo === "string" && /^https:\/\//i.test(c.photo) ? c.photo.slice(0, 2048) : null,
          contact: c.contact && typeof c.contact === "object" ? c.contact : null,
          created_at: dateValue(c.createdAt),
          updated_at: new Date().toISOString()
        };
        const { data: savedChat, error: saveChatError } = await supabase.from("vivo_chats")
          .upsert(chatRow, { onConflict: "owner_id,client_id" }).select("id").single();
        if (saveChatError || !savedChat) return json(500, { ok: false, error: "ذخیره یکی از گفتگوها ناموفق بود." });
        const { error: memberError } = await supabase.from("vivo_chat_members").upsert(
          { chat_id: savedChat.id, user_id: userId, role: "owner" },
          { onConflict: "chat_id,user_id" }
        );
        if (memberError) return json(500, { ok: false, error: "ثبت عضویت گفتگو ناموفق بود." });
        const items = Array.isArray(c.messages) ? c.messages.slice(0, 500) : [];
        totalMessages += items.length;
        if (totalMessages > 3000) return json(413, { ok: false, error: "تعداد پیام‌های ارسالی بیش از حد مجاز است." });
        const rows = items.map((m: any, index: number) => {
          const attachment = m?.attachment && typeof m.attachment === "object" &&
            JSON.stringify(m.attachment).length <= 250000 ? m.attachment : null;
          return {
            chat_id: savedChat.id,
            owner_id: userId,
            client_id: safeText(m?.id || (String(c.id) + "-" + index), 160),
            sender_type: ["other","system","bot"].includes(m?.from) ? m.from : "me",
            body: safeText(m?.text, 8000),
            attachment,
            reply_to: m?.replyTo ? safeText(m.replyTo, 160) : null,
            sent_at: dateValue(m?.at)
          };
        });
        if (rows.length) {
          const { error: messageError } = await supabase.from("vivo_messages")
            .upsert(rows, { onConflict: "chat_id,client_id" });
          if (messageError) return json(500, { ok: false, error: "ذخیره پیام‌ها ناموفق بود." });
        }
      }
      return json(200, { ok: true, savedChats: body.chats.length, savedMessages: totalMessages });
    }

    return json(404, { ok: false, error: "مسیر پیدا نشد." });
  } catch (error) {
    console.error("VIVO API error:", error);
    return json(500, { ok: false, error: "خطای داخلی سرویس ویوو." });
  }
});
