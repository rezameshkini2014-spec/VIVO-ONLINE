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
    const { data: account, error: accountError } = await supabase.from("vivo_users")
      .select("id,is_suspended").eq("id", payload.sub).single();
    if (accountError || !account || account.is_suspended) return null;
    return payload.sub as string;
  } catch {
    return null;
  }
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

async function blockedUsers(userId: string) {
  const { data, error } = await supabase.from("vivo_blocks")
    .select("blocker_id,blocked_id")
    .or("blocker_id.eq." + userId + ",blocked_id.eq." + userId);
  if (error) throw error;
  const result = new Set<string>();
  for (const row of data || []) result.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id);
  return result;
}
async function followsUser(followerId: string, followingId: string) {
  const { data, error } = await supabase.from("vivo_follows")
    .select("follower_id").eq("follower_id", followerId)
    .eq("following_id", followingId).eq("status", "accepted").maybeSingle();
  if (error) throw error;
  return !!data;
}
async function canViewPost(post: any, viewerId: string, blocked?: Set<string>) {
  if (post.author_id === viewerId) return true;
  const blockedSet = blocked || await blockedUsers(viewerId);
  if (blockedSet.has(post.author_id)) return false;
  if (post.audience === "private") return false;
  const { data: author, error } = await supabase.from("vivo_users")
    .select("is_private,is_suspended").eq("id", post.author_id).single();
  if (error || !author || author.is_suspended) return false;
  if (post.audience === "followers" || author.is_private) return await followsUser(viewerId, post.author_id);
  return true;
}
async function decoratePosts(posts: any[], viewerId: string) {
  if (!posts.length) return [];
  const postIds = posts.map(p => p.id);
  const authorIds = [...new Set(posts.map(p => p.author_id))];
  const [authorsResult, likesResult, commentsResult] = await Promise.all([
    supabase.from("vivo_users").select("id,display_name,username,bio,avatar_url,is_private").in("id", authorIds),
    supabase.from("vivo_post_likes").select("post_id,user_id").in("post_id", postIds),
    supabase.from("vivo_comments").select("id,post_id").in("post_id", postIds).is("deleted_at", null)
  ]);
  if (authorsResult.error || likesResult.error || commentsResult.error) throw new Error("دریافت جزئیات پست‌ها ناموفق بود.");
  const authors = new Map((authorsResult.data || []).map((x: any) => [x.id, x]));
  const likes = likesResult.data || [], comments = commentsResult.data || [];
  return posts.map(p => ({
    id: p.id, body: p.body, media: p.media || [], audience: p.audience,
    createdAt: new Date(p.created_at).getTime(),
    author: authors.get(p.author_id) || null,
    likes: likes.filter((x: any) => x.post_id === p.id).length,
    comments: comments.filter((x: any) => x.post_id === p.id).length,
    liked: likes.some((x: any) => x.post_id === p.id && x.user_id === viewerId)
  }));
}
async function addNotification(recipientId: string, actorId: string, kind: string, entityType?: string, entityId?: string, payload: Record<string, unknown> = {}) {
  if (!recipientId || recipientId === actorId) return;
  await supabase.from("vivo_notifications").insert({
    recipient_id: recipientId, actor_id: actorId, kind,
    entity_type: entityType || null, entity_id: entityId || null, payload
  });
}

async function isChatMember(chatId: string, userId: string) {
  const { data: chat } = await supabase.from("vivo_chats").select("id,owner_id,chat_type").eq("id", chatId).maybeSingle();
  if (!chat) return false;
  const { data: membership } = await supabase.from("vivo_chat_members").select("chat_id").eq("chat_id", chatId).eq("user_id", userId).maybeSingle();
  if (!membership && chat.owner_id !== userId) return false;
  if (chat.chat_type === "private") {
    const { data: others } = await supabase.from("vivo_chat_members").select("user_id").eq("chat_id", chatId).neq("user_id", userId);
    const blocked = await blockedUsers(userId);
    if ((others || []).some((x: any) => blocked.has(x.user_id))) return false;
  }
  return true;
}
async function isChatAdmin(chatId: string, userId: string) {
  const { data: chat } = await supabase.from("vivo_chats").select("owner_id").eq("id", chatId).maybeSingle();
  if (chat?.owner_id === userId) return true;
  const { data: member } = await supabase.from("vivo_chat_members").select("role").eq("chat_id", chatId).eq("user_id", userId).maybeSingle();
  return member?.role === "admin" || member?.role === "owner";
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

    return json(503, { ok: false, error: "احراز هویت ویوو تا تکمیل سامانه نشست امن غیرفعال است." });

    const userId = await authenticate(req, key);
    if (!userId) return json(401, { ok: false, error: "نشست معتبر نیست؛ دوباره وارد شوید." });



    if (path === "/chat/list" && req.method === "GET") {
      const { data: memberships, error: memberError } = await supabase.from("vivo_chat_members").select("chat_id,role,last_read_at,is_muted").eq("user_id", userId);
      if (memberError) return json(500, { ok: false, error: "دریافت عضویت گفتگوها ناموفق بود." });
      const ids = [...new Set((memberships || []).map((x: any) => x.chat_id))];
      const { data: owned, error: ownedError } = await supabase.from("vivo_chats").select("id").eq("owner_id", userId);
      if (ownedError) return json(500, { ok: false, error: "دریافت گفتگوهای شما ناموفق بود." });
      for (const row of owned || []) if (!ids.includes(row.id)) ids.push(row.id);
      if (!ids.length) return json(200, { ok: true, chats: [] });
      const [chatsResult, messagesResult, membersResult] = await Promise.all([
        supabase.from("vivo_chats").select("id,owner_id,name,chat_type,description,pinned,photo,created_at,last_message_at,is_archived").in("id", ids).eq("is_archived", false),
        supabase.from("vivo_messages").select("id,chat_id,sender_id,body,attachment,sent_at,status,deleted_at").in("chat_id", ids).order("sent_at", { ascending: false }).limit(300),
        supabase.from("vivo_chat_members").select("chat_id,user_id,role,last_read_at,is_muted").in("chat_id", ids)
      ]);
      if (chatsResult.error || messagesResult.error || membersResult.error) return json(500, { ok: false, error: "همگام‌سازی گفتگوها ناموفق بود." });
      const allMembers = membersResult.data || [];
      const userIds = [...new Set(allMembers.map((x: any) => x.user_id).concat((chatsResult.data || []).map((x: any) => x.owner_id)))];
      const usersResult = userIds.length ? await supabase.from("vivo_users").select("id,display_name,username,avatar_url").in("id", userIds) : { data: [], error: null };
      const userMap = new Map((usersResult.data || []).map((x: any) => [x.id, x]));
      const latest = new Map<string, any>(), unread = new Map<string, number>();
      for (const msg of messagesResult.data || []) {
        if (msg.deleted_at) continue;
        if (!latest.has(msg.chat_id)) latest.set(msg.chat_id, msg);
        if (msg.sender_id && msg.sender_id !== userId) {
          const membership = allMembers.find((x: any) => x.chat_id === msg.chat_id && x.user_id === userId);
          if (!membership?.last_read_at || new Date(msg.sent_at).getTime() > new Date(membership.last_read_at).getTime()) unread.set(msg.chat_id, (unread.get(msg.chat_id) || 0) + 1);
        }
      }
      const blocked = await blockedUsers(userId);
      const result = (chatsResult.data || []).map((chat: any) => {
        const members = allMembers.filter((x: any) => x.chat_id === chat.id);
        const others = members.filter((x: any) => x.user_id !== userId).map((x: any) => userMap.get(x.user_id)).filter(Boolean);
        const last = latest.get(chat.id), member = members.find((x: any) => x.user_id === userId);
        return { id: chat.id, name: chat.chat_type === "private" ? (others[0]?.display_name || chat.name) : chat.name,
          type: chat.chat_type, description: chat.description, photo: chat.photo, pinned: chat.pinned,
          unread: unread.get(chat.id) || 0, muted: !!member?.is_muted, participants: others,
          lastMessage: last ? { text: last.body, senderId: last.sender_id, sentAt: new Date(last.sent_at).getTime(), status: last.status } : null,
          updatedAt: new Date(chat.last_message_at || chat.created_at).getTime() };
      }).filter((chat: any) => chat.type !== "private" || !chat.participants.some((person: any) => blocked.has(person.id)))
        .sort((a: any,b: any) => Number(b.updatedAt)-Number(a.updatedAt));
      return json(200, { ok: true, chats: result });
    }

    if (path === "/chat/create" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), type = body.type === "group" ? "group" : "private";
      const blocked = await blockedUsers(userId);
      if (type === "private") {
        const username = safeText(body.username, 30).trim().toLowerCase();
        const { data: target } = await supabase.from("vivo_users").select("id,username,display_name,is_suspended").eq("username", username).maybeSingle();
        if (!target || target.is_suspended || target.id === userId || blocked.has(target.id)) return json(404, { ok: false, error: "کاربر مقصد در دسترس نیست." });
        const mutual = await followsUser(userId, target.id) && await followsUser(target.id, userId);
        if (!mutual) return json(403, { ok: false, error: "برای حفظ حریم خصوصی، گفت‌وگوی خصوصی فقط بین دنبال‌کنندگان متقابل فعال است." });
        const keyValue = [userId, target.id].sort().join(":");
        let { data: chat } = await supabase.from("vivo_chats").select("*").eq("conversation_key", keyValue).maybeSingle();
        if (!chat) {
          const created = await supabase.from("vivo_chats").insert({ owner_id: userId, client_id: crypto.randomUUID(), name: target.display_name, chat_type: "private", description: "", conversation_key: keyValue }).select("*").single();
          if (created.error || !created.data) return json(500, { ok: false, error: "ساخت گفت‌وگو انجام نشد." });
          chat = created.data;
        }
        const { error } = await supabase.from("vivo_chat_members").upsert([{ chat_id: chat.id, user_id: userId, role: "member" }, { chat_id: chat.id, user_id: target.id, role: "member" }], { onConflict: "chat_id,user_id" });
        if (error) return json(500, { ok: false, error: "ثبت اعضای گفت‌وگو انجام نشد." });
        return json(200, { ok: true, chat: { id: chat.id, name: target.display_name, type: "private" } });
      }
      const name = safeText(body.name, 60).trim();
      const usernames = Array.isArray(body.usernames) ? [...new Set(body.usernames.map((x: any) => safeText(x, 30).trim().toLowerCase()).filter(Boolean))].slice(0, 49) : [];
      if (name.length < 2 || usernames.length < 1) return json(400, { ok: false, error: "نام گروه و دست‌کم یک عضو لازم است." });
      const { data: targets, error: targetError } = await supabase.from("vivo_users").select("id,username,display_name,is_suspended").in("username", usernames);
      if (targetError || (targets || []).length !== usernames.length) return json(400, { ok: false, error: "یکی از نام‌های کاربری پیدا نشد." });
      for (const target of targets || []) {
        if (target.is_suspended || target.id === userId || blocked.has(target.id) || !(await followsUser(userId, target.id)) || !(await followsUser(target.id, userId))) return json(403, { ok: false, error: "همه اعضا باید حساب‌های فعال و ارتباط دنبال‌کردن متقابل داشته باشند." });
      }
      const created = await supabase.from("vivo_chats").insert({ owner_id: userId, client_id: crypto.randomUUID(), name, chat_type: "group", description: safeText(body.description, 300) }).select("*").single();
      if (created.error || !created.data) return json(500, { ok: false, error: "ساخت گروه انجام نشد." });
      const rows = [{ chat_id: created.data.id, user_id: userId, role: "admin" }, ...(targets || []).map((x: any) => ({ chat_id: created.data.id, user_id: x.id, role: "member" }))];
      const { error: addError } = await supabase.from("vivo_chat_members").upsert(rows, { onConflict: "chat_id,user_id" });
      if (addError) { await supabase.from("vivo_chats").delete().eq("id", created.data.id).eq("owner_id", userId); return json(500, { ok: false, error: "ثبت اعضای گروه انجام نشد." }); }
      for (const target of targets || []) await addNotification(target.id, userId, "group_invite", "chat", created.data.id, { name });
      return json(201, { ok: true, chat: { id: created.data.id, name, type: "group" } });
    }

    if (path === "/chat/messages" && req.method === "GET") {
      const chatId = url.searchParams.get("chatId") || "";
      if (!chatId || !(await isChatMember(chatId, userId))) return json(404, { ok: false, error: "گفت‌وگو پیدا نشد." });
      const { data, error } = await supabase.from("vivo_messages").select("id,chat_id,sender_id,sender_type,body,attachment,reply_to,sent_at,status,edited_at,deleted_at").eq("chat_id", chatId).is("deleted_at", null).order("sent_at", { ascending: true }).limit(200);
      if (error) return json(500, { ok: false, error: "دریافت پیام‌ها ناموفق بود." });
      const senderIds = [...new Set((data || []).map((x: any) => x.sender_id).filter(Boolean))];
      const messageIds = (data || []).map((x: any) => x.id);
      const [users, reactionsResult] = await Promise.all([
        senderIds.length ? supabase.from("vivo_users").select("id,display_name,username,avatar_url").in("id", senderIds) : Promise.resolve({ data: [], error: null }),
        messageIds.length ? supabase.from("vivo_message_reactions").select("message_id,user_id,reaction").in("message_id", messageIds) : Promise.resolve({ data: [], error: null })
      ]);
      if (users.error || reactionsResult.error) return json(500, { ok: false, error: "دریافت جزئیات پیام‌ها ناموفق بود." });
      const userMap = new Map((users.data || []).map((x: any) => [x.id, x]));
      const reactionsByMessage = new Map<string, any[]>();
      for (const item of reactionsResult.data || []) {
        const list = reactionsByMessage.get(item.message_id) || [];
        const existing = list.find((x: any) => x.reaction === item.reaction);
        if (existing) { existing.count++; existing.mine ||= item.user_id === userId; }
        else list.push({ reaction: item.reaction, count: 1, mine: item.user_id === userId });
        reactionsByMessage.set(item.message_id, list);
      }
      return json(200, { ok: true, messages: (data || []).map((x: any) => ({ id: x.id, senderId: x.sender_id, sender: userMap.get(x.sender_id) || null, fromMe: x.sender_id === userId, text: x.body, attachment: x.attachment, replyTo: x.reply_to, sentAt: new Date(x.sent_at).getTime(), status: x.status, editedAt: x.edited_at, reactions: reactionsByMessage.get(x.id) || [] })) });
    }

    if (path === "/chat/send" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64), text = safeText(body.text, 5000).trim();
      const attachment = body.attachment && typeof body.attachment === "object" ? body.attachment : null;
      if (!chatId || (!text && !attachment) || !(await isChatMember(chatId, userId))) return json(400, { ok: false, error: "پیام یا گفت‌وگوی معتبر نیست." });
      if (attachment?.path) {
        const { data: owned } = await supabase.from("vivo_media").select("object_path").eq("owner_id", userId).eq("object_path", safeText(attachment.path, 500)).maybeSingle();
        if (!owned) return json(403, { ok: false, error: "فایل پیوست متعلق به این حساب نیست." });
      }
      const replyTo = body.replyTo ? safeText(body.replyTo, 64) : null;
      if (replyTo) { const { data: parent } = await supabase.from("vivo_messages").select("id,chat_id").eq("id", replyTo).maybeSingle(); if (!parent || parent.chat_id !== chatId) return json(400, { ok: false, error: "پیام پاسخ معتبر نیست." }); }
      const { data: message, error } = await supabase.from("vivo_messages").insert({ chat_id: chatId, owner_id: userId, client_id: crypto.randomUUID(), sender_id: userId, sender_type: "me", body: text, attachment, reply_to: replyTo, status: "sent" }).select("id,chat_id,sender_id,body,attachment,reply_to,sent_at,status").single();
      if (error || !message) return json(500, { ok: false, error: "ارسال پیام انجام نشد." });
      await supabase.from("vivo_chats").update({ last_message_at: message.sent_at, updated_at: message.sent_at }).eq("id", chatId);
      const { data: members } = await supabase.from("vivo_chat_members").select("user_id,is_muted").eq("chat_id", chatId);
      for (const member of members || []) if (member.user_id !== userId && !member.is_muted) await addNotification(member.user_id, userId, "message", "chat", chatId, { preview: text.slice(0, 80) });
      return json(201, { ok: true, message });
    }

    if (path === "/chat/read" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64);
      if (!chatId || !(await isChatMember(chatId, userId))) return json(404, { ok: false, error: "گفت‌وگو پیدا نشد." });
      const { error } = await supabase.from("vivo_chat_members").upsert({ chat_id: chatId, user_id: userId, last_read_at: new Date().toISOString() }, { onConflict: "chat_id,user_id" });
      if (error) return json(500, { ok: false, error: "ثبت وضعیت خوانده‌شدن انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/chat/react" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), messageId = safeText(body.messageId, 64), reaction = safeText(body.reaction, 32);
      const { data: message } = await supabase.from("vivo_messages").select("id,chat_id").eq("id", messageId).maybeSingle();
      if (!message || !(await isChatMember(message.chat_id, userId)) || !reaction) return json(404, { ok: false, error: "پیام در دسترس نیست." });
      const { error } = await supabase.from("vivo_message_reactions").upsert({ message_id: messageId, user_id: userId, reaction }, { onConflict: "message_id,user_id,reaction" });
      if (error) return json(500, { ok: false, error: "ثبت واکنش انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/chat/edit" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), messageId = safeText(body.messageId, 64), text = safeText(body.text, 5000).trim();
      const { data: message } = await supabase.from("vivo_messages").select("id,sender_id,sent_at,deleted_at").eq("id", messageId).maybeSingle();
      if (!message || message.sender_id !== userId || message.deleted_at || Date.now()-new Date(message.sent_at).getTime()>15*60*1000 || !text) return json(403, { ok: false, error: "ویرایش این پیام مجاز نیست." });
      const { error } = await supabase.from("vivo_messages").update({ body: text, edited_at: new Date().toISOString() }).eq("id", messageId).eq("sender_id", userId);
      if (error) return json(500, { ok: false, error: "ویرایش پیام انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/chat/delete" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), messageId = safeText(body.messageId, 64);
      const { data: message } = await supabase.from("vivo_messages").select("id,sender_id,deleted_at").eq("id", messageId).maybeSingle();
      if (!message || message.sender_id !== userId || message.deleted_at) return json(403, { ok: false, error: "حذف این پیام مجاز نیست." });
      const { error } = await supabase.from("vivo_messages").update({ body: "", attachment: null, deleted_at: new Date().toISOString() }).eq("id", messageId).eq("sender_id", userId);
      if (error) return json(500, { ok: false, error: "حذف پیام انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/chat/mute" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64), muted = !!body.muted;
      if (!chatId || !(await isChatMember(chatId, userId))) return json(404, { ok: false, error: "گفت‌وگو پیدا نشد." });
      const { error } = await supabase.from("vivo_chat_members").upsert({ chat_id: chatId, user_id: userId, is_muted: muted }, { onConflict: "chat_id,user_id" });
      if (error) return json(500, { ok: false, error: "تنظیم بی‌صداکردن انجام نشد." });
      return json(200, { ok: true, muted });
    }

    if (path === "/chat/rename" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64), name = safeText(body.name, 60).trim();
      if (!chatId || name.length < 2 || !(await isChatAdmin(chatId, userId))) return json(403, { ok: false, error: "اجازه تغییر نام گروه را نداری." });
      const { error } = await supabase.from("vivo_chats").update({ name, description: safeText(body.description, 300), updated_at: new Date().toISOString() }).eq("id", chatId).eq("chat_type", "group");
      if (error) return json(500, { ok: false, error: "تغییر مشخصات گروه انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/chat/members/add" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64);
      const usernames = Array.isArray(body.usernames) ? [...new Set(body.usernames.map((x: any) => safeText(x, 30).trim().toLowerCase()).filter(Boolean))].slice(0, 30) : [];
      if (!chatId || !usernames.length || !(await isChatAdmin(chatId, userId))) return json(403, { ok: false, error: "افزودن عضو مجاز نیست." });
      const { data: chat } = await supabase.from("vivo_chats").select("id,chat_type,name").eq("id", chatId).maybeSingle();
      if (!chat || chat.chat_type !== "group") return json(400, { ok: false, error: "این عملیات فقط برای گروه است." });
      const { data: targets } = await supabase.from("vivo_users").select("id,username,is_suspended").in("username", usernames);
      if ((targets || []).length !== usernames.length) return json(400, { ok: false, error: "یکی از کاربران پیدا نشد." });
      const blocked = await blockedUsers(userId);
      for (const target of targets || []) if (target.is_suspended || target.id === userId || blocked.has(target.id) || !(await followsUser(userId, target.id)) || !(await followsUser(target.id, userId))) return json(403, { ok: false, error: "افزودن یکی از اعضا مجاز نیست." });
      const { error } = await supabase.from("vivo_chat_members").upsert((targets || []).map((x: any) => ({ chat_id: chatId, user_id: x.id, role: "member" })), { onConflict: "chat_id,user_id" });
      if (error) return json(500, { ok: false, error: "افزودن اعضا انجام نشد." });
      for (const target of targets || []) await addNotification(target.id, userId, "group_invite", "chat", chatId, { name: chat.name });
      return json(200, { ok: true, added: targets?.length || 0 });
    }

    if (path === "/chat/members/remove" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64), targetId = safeText(body.userId, 64);
      if (!chatId || !targetId || targetId === userId || !(await isChatAdmin(chatId, userId))) return json(403, { ok: false, error: "حذف این عضو مجاز نیست." });
      const { data: chat } = await supabase.from("vivo_chats").select("owner_id,chat_type").eq("id", chatId).maybeSingle();
      if (!chat || chat.chat_type !== "group" || chat.owner_id === targetId) return json(403, { ok: false, error: "مدیر اصلی گروه قابل حذف نیست." });
      const { error } = await supabase.from("vivo_chat_members").delete().eq("chat_id", chatId).eq("user_id", targetId);
      if (error) return json(500, { ok: false, error: "حذف عضو انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/chat/leave" && req.method === "POST") {
      const body = await req.json().catch(() => ({})), chatId = safeText(body.chatId, 64);
      if (!chatId || !(await isChatMember(chatId, userId))) return json(404, { ok: false, error: "گفت‌وگو پیدا نشد." });
      const { data: chat } = await supabase.from("vivo_chats").select("owner_id,chat_type").eq("id", chatId).maybeSingle();
      if (chat?.owner_id === userId) {
        const { data: others } = await supabase.from("vivo_chat_members").select("user_id").eq("chat_id", chatId).neq("user_id", userId).order("joined_at", { ascending: true }).limit(1);
        if (others?.length) {
          await supabase.from("vivo_chats").update({ owner_id: others[0].user_id }).eq("id", chatId);
          await supabase.from("vivo_chat_members").update({ role: "admin" }).eq("chat_id", chatId).eq("user_id", others[0].user_id);
        } else {
          await supabase.from("vivo_chats").delete().eq("id", chatId);
          return json(200, { ok: true, deleted: true });
        }
      }
      const { error } = await supabase.from("vivo_chat_members").delete().eq("chat_id", chatId).eq("user_id", userId);
      if (error) return json(500, { ok: false, error: "خروج از گفتگو انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/social/feed" && req.method === "GET") {
      const blocked = await blockedUsers(userId);
      const { data: follows, error: followError } = await supabase.from("vivo_follows")
        .select("following_id").eq("follower_id", userId).eq("status", "accepted");
      if (followError) return json(500, { ok: false, error: "دریافت دنبال‌شوندگان ناموفق بود." });
      const followedIds = (follows || []).map((x: any) => x.following_id).filter((id: string) => !blocked.has(id));
      const { data: publicPosts, error: publicError } = await supabase.from("vivo_posts")
        .select("*").eq("status", "published").eq("audience", "public")
        .is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
      if (publicError) return json(500, { ok: false, error: "دریافت فید ناموفق بود." });
      let followedPosts: any[] = [];
      if (followedIds.length) {
        const { data, error } = await supabase.from("vivo_posts")
          .select("*").in("author_id", followedIds).in("audience", ["followers", "public"])
          .eq("status", "published").is("deleted_at", null)
          .order("created_at", { ascending: false }).limit(50);
        if (error) return json(500, { ok: false, error: "دریافت پست‌های دنبال‌شوندگان ناموفق بود." });
        followedPosts = data || [];
      }
      const ownResult = await supabase.from("vivo_posts").select("*").eq("author_id", userId)
        .eq("status", "published").is("deleted_at", null).order("created_at", { ascending: false }).limit(30);
      if (ownResult.error) return json(500, { ok: false, error: "دریافت پست‌های شما ناموفق بود." });
      const unique = new Map<string, any>();
      for (const p of [...(publicPosts || []), ...followedPosts, ...(ownResult.data || [])]) {
        if (p.author_id !== userId && blocked.has(p.author_id)) continue;
        unique.set(p.id, p);
      }
      const authorIds = [...new Set([...unique.values()].map((p: any) => p.author_id))];
      const authorsResult = authorIds.length ? await supabase.from("vivo_users").select("id,is_private,is_suspended").in("id", authorIds) : { data: [], error: null };
      if (authorsResult.error) return json(500, { ok: false, error: "بررسی حریم خصوصی ناموفق بود." });
      const authorMap = new Map((authorsResult.data || []).map((x: any) => [x.id, x]));
      const visible = [...unique.values()].filter((p: any) => {
        const author: any = authorMap.get(p.author_id);
        if (!author || author.is_suspended) return false;
        if (p.author_id !== userId && author.is_private && !followedIds.includes(p.author_id)) return false;
        if (p.audience === "followers" && p.author_id !== userId && !followedIds.includes(p.author_id)) return false;
        if (p.audience === "private" && p.author_id !== userId) return false;
        return true;
      }).sort((a: any,b: any) => new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,50);
      return json(200, { ok: true, posts: await decoratePosts(visible, userId) });
    }

    if (path === "/social/posts" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const text = safeText(body.text, 2200).trim();
      const media = Array.isArray(body.media) ? body.media.slice(0, 10) : [];
      const audience = ["public", "followers", "private"].includes(body.audience) ? body.audience : "followers";
      if (!text && !media.length) return json(400, { ok: false, error: "برای انتشار، متن یا رسانه انتخاب کن." });
      if (media.length) {
        const paths = media.map((x: any) => safeText(x?.path, 500)).filter(Boolean);
        const { data: owned, error } = await supabase.from("vivo_media").select("object_path").eq("owner_id", userId).in("object_path", paths);
        if (error || paths.length !== media.length || (owned || []).length !== media.length) return json(403, { ok: false, error: "یکی از فایل‌ها متعلق به این حساب نیست." });
      }
      const { data: account } = await supabase.from("vivo_users").select("is_private").eq("id", userId).single();
      const safeAudience = account?.is_private && audience === "public" ? "followers" : audience;
      const { data, error } = await supabase.from("vivo_posts").insert({
        author_id: userId, body: text, media, audience: safeAudience, status: "published"
      }).select("*").single();
      if (error || !data) return json(500, { ok: false, error: "انتشار پست انجام نشد." });
      return json(201, { ok: true, post: (await decoratePosts([data], userId))[0] });
    }

    if (path === "/social/like" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const postId = safeText(body.postId, 64);
      if (!postId) return json(400, { ok: false, error: "شناسه پست معتبر نیست." });
      const { data: post, error: postError } = await supabase.from("vivo_posts").select("id,author_id,audience,status,deleted_at").eq("id", postId).maybeSingle();
      if (postError || !post || post.status !== "published" || post.deleted_at || !(await canViewPost(post, userId))) return json(404, { ok: false, error: "این پست در دسترس نیست." });
      const { data: existing } = await supabase.from("vivo_post_likes").select("post_id").eq("post_id", postId).eq("user_id", userId).maybeSingle();
      if (existing) {
        await supabase.from("vivo_post_likes").delete().eq("post_id", postId).eq("user_id", userId);
        return json(200, { ok: true, liked: false });
      }
      const { error } = await supabase.from("vivo_post_likes").insert({ post_id: postId, user_id: userId });
      if (error) return json(500, { ok: false, error: "ثبت پسند انجام نشد." });
      await addNotification(post.author_id, userId, "like", "post", postId);
      return json(200, { ok: true, liked: true });
    }

    if (path === "/social/comment" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const postId = safeText(body.postId, 64), commentText = safeText(body.text, 1000).trim();
      const parentId = body.parentId ? safeText(body.parentId, 64) : null;
      if (!postId || !commentText) return json(400, { ok: false, error: "متن دیدگاه خالی است." });
      const { data: post } = await supabase.from("vivo_posts").select("id,author_id,audience,status,deleted_at").eq("id", postId).maybeSingle();
      if (!post || post.status !== "published" || post.deleted_at || !(await canViewPost(post, userId))) return json(404, { ok: false, error: "این پست در دسترس نیست." });
      if (parentId) {
        const { data: parent } = await supabase.from("vivo_comments").select("id,post_id").eq("id", parentId).maybeSingle();
        if (!parent || parent.post_id !== postId) return json(400, { ok: false, error: "دیدگاه والد معتبر نیست." });
      }
      const { data, error } = await supabase.from("vivo_comments").insert({ post_id: postId, author_id: userId, parent_id: parentId, body: commentText }).select("id,post_id,author_id,parent_id,body,created_at").single();
      if (error || !data) return json(500, { ok: false, error: "ثبت دیدگاه انجام نشد." });
      await addNotification(post.author_id, userId, parentId ? "reply" : "comment", "post", postId);
      return json(201, { ok: true, comment: data });
    }

    if (path === "/social/comments" && req.method === "GET") {
      const postId = url.searchParams.get("postId") || "";
      const { data: post } = await supabase.from("vivo_posts").select("id,author_id,audience,status,deleted_at").eq("id", postId).maybeSingle();
      if (!post || post.status !== "published" || post.deleted_at || !(await canViewPost(post, userId))) return json(404, { ok: false, error: "این پست در دسترس نیست." });
      const { data, error } = await supabase.from("vivo_comments").select("id,post_id,author_id,parent_id,body,created_at")
        .eq("post_id", postId).is("deleted_at", null).order("created_at", { ascending: true }).limit(200);
      if (error) return json(500, { ok: false, error: "دریافت دیدگاه‌ها ناموفق بود." });
      const ids = [...new Set((data || []).map((x: any) => x.author_id))];
      const authors = ids.length ? await supabase.from("vivo_users").select("id,display_name,username,avatar_url").in("id", ids) : { data: [], error: null };
      const authorMap = new Map((authors.data || []).map((x: any) => [x.id, x]));
      return json(200, { ok: true, comments: (data || []).map((x: any) => ({ ...x, author: authorMap.get(x.author_id) || null })) });
    }

    if (path === "/social/follow" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const username = safeText(body.username, 30).trim().toLowerCase();
      const { data: target, error } = await supabase.from("vivo_users").select("id,username,display_name,is_private,is_suspended").eq("username", username).maybeSingle();
      if (error || !target || target.is_suspended) return json(404, { ok: false, error: "کاربر پیدا نشد." });
      if (target.id === userId) return json(400, { ok: false, error: "نمی‌توانی خودت را دنبال کنی." });
      const blocked = await blockedUsers(userId);
      if (blocked.has(target.id)) return json(403, { ok: false, error: "ارتباط با این حساب در دسترس نیست." });
      const status = target.is_private ? "pending" : "accepted";
      const { error: saveError } = await supabase.from("vivo_follows").upsert({ follower_id: userId, following_id: target.id, status }, { onConflict: "follower_id,following_id" });
      if (saveError) return json(500, { ok: false, error: "ثبت درخواست دنبال‌کردن انجام نشد." });
      await addNotification(target.id, userId, "follow", "user", userId, { status });
      return json(200, { ok: true, status });
    }

    if (path === "/social/unfollow" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const targetId = safeText(body.userId, 64);
      if (!targetId || targetId === userId) return json(400, { ok: false, error: "کاربر مقصد معتبر نیست." });
      const { error } = await supabase.from("vivo_follows").delete().eq("follower_id", userId).eq("following_id", targetId);
      if (error) return json(500, { ok: false, error: "لغو دنبال‌کردن انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/social/search" && req.method === "GET") {
      const query = safeText(url.searchParams.get("q"), 80).replace(/[^a-zA-Z0-9_\s\u0600-\u06FF]/g, "").trim();
      if (query.length < 2) return json(200, { ok: true, users: [] });
      const blocked = await blockedUsers(userId);
      const { data, error } = await supabase.from("vivo_users")
        .select("id,display_name,username,bio,avatar_url,is_private")
        .eq("is_suspended", false).or("username.ilike.%" + query + "%,display_name.ilike.%" + query + "%")
        .limit(30);
      if (error) return json(500, { ok: false, error: "جست‌وجوی کاربران ناموفق بود." });
      return json(200, { ok: true, users: (data || []).filter((x: any) => x.id === userId || !blocked.has(x.id)) });
    }

    if (path.startsWith("/social/profile/") && req.method === "GET") {
      const username = decodeURIComponent(path.slice("/social/profile/".length)).trim().toLowerCase();
      const { data: target, error } = await supabase.from("vivo_users")
        .select("id,display_name,username,bio,avatar_url,is_private,is_suspended,created_at")
        .eq("username", username).maybeSingle();
      if (error || !target || target.is_suspended) return json(404, { ok: false, error: "پروفایل پیدا نشد." });
      const following = target.id === userId ? true : await followsUser(userId, target.id);
      const blocked = await blockedUsers(userId);
      if (blocked.has(target.id)) return json(404, { ok: false, error: "پروفایل پیدا نشد." });
      const privateLocked = target.is_private && !following;
      const { count: postsCount } = await supabase.from("vivo_posts").select("id", { count: "exact", head: true })
        .eq("author_id", target.id).eq("status", "published").is("deleted_at", null);
      const { count: followersCount } = await supabase.from("vivo_follows").select("follower_id", { count: "exact", head: true }).eq("following_id", target.id).eq("status", "accepted");
      const { count: followingCount } = await supabase.from("vivo_follows").select("following_id", { count: "exact", head: true }).eq("follower_id", target.id).eq("status", "accepted");
      let posts: any[] = [];
      if (!privateLocked) {
        const { data } = await supabase.from("vivo_posts").select("*").eq("author_id", target.id)
          .eq("status", "published").is("deleted_at", null).order("created_at", { ascending: false }).limit(30);
        const visiblePosts = (data || []).filter((p: any) =>
          p.author_id === userId || p.audience === "public" || (p.audience === "followers" && following)
        );
        posts = await decoratePosts(visiblePosts, userId);
      }
      return json(200, { ok: true, profile: { id: target.id, name: target.display_name, username: target.username, bio: target.bio, avatarUrl: target.avatar_url, isPrivate: target.is_private, following, privateLocked, postsCount: postsCount || 0, followersCount: followersCount || 0, followingCount: followingCount || 0 }, posts });
    }

    if (path === "/social/stories" && req.method === "GET") {
      const blocked = await blockedUsers(userId);
      const { data: follows } = await supabase.from("vivo_follows").select("following_id").eq("follower_id", userId).eq("status", "accepted");
      const followedIds = (follows || []).map((x: any) => x.following_id);
      const { data, error } = await supabase.from("vivo_stories").select("*").gt("expires_at", new Date().toISOString())
        .is("deleted_at", null).order("created_at", { ascending: true }).limit(100);
      if (error) return json(500, { ok: false, error: "دریافت استوری‌ها ناموفق بود." });
      const ids = [...new Set((data || []).map((x: any) => x.author_id))];
      const authors = ids.length ? await supabase.from("vivo_users").select("id,display_name,username,avatar_url,is_private,is_suspended").in("id", ids) : { data: [], error: null };
      const authorMap = new Map((authors.data || []).map((x: any) => [x.id, x]));
      const stories = (data || []).filter((x: any) => {
        const author: any = authorMap.get(x.author_id);
        if (!author || author.is_suspended || blocked.has(x.author_id)) return false;
        if (x.author_id === userId) return true;
        if (x.audience === "private") return false;
        if (x.audience === "followers" || author.is_private) return followedIds.includes(x.author_id);
        return true;
      }).map((x: any) => ({ id: x.id, body: x.body, mediaPath: x.media_path, mediaType: x.media_type, background: x.background, createdAt: new Date(x.created_at).getTime(), expiresAt: new Date(x.expires_at).getTime(), author: authorMap.get(x.author_id) }));
      return json(200, { ok: true, stories });
    }

    if (path === "/social/stories" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const text = safeText(body.text, 500).trim();
      const mediaPath = body.mediaPath ? safeText(body.mediaPath, 500) : null;
      const mediaType = ["text", "image", "video"].includes(body.mediaType) ? body.mediaType : (mediaPath ? "image" : "text");
      if (!text && !mediaPath) return json(400, { ok: false, error: "برای استوری متن یا رسانه انتخاب کن." });
      if (mediaPath) {
        const { data: owned } = await supabase.from("vivo_media").select("object_path").eq("owner_id", userId).eq("object_path", mediaPath).maybeSingle();
        if (!owned) return json(403, { ok: false, error: "فایل استوری متعلق به این حساب نیست." });
      }
      const audience = ["public", "followers", "private"].includes(body.audience) ? body.audience : "followers";
      const { data: account } = await supabase.from("vivo_users").select("is_private").eq("id", userId).single();
      const safeAudience = account?.is_private && audience === "public" ? "followers" : audience;
      const { data, error } = await supabase.from("vivo_stories").insert({
        author_id: userId, body: text, media_path: mediaPath, media_type: mediaType,
        background: safeText(body.background || "blue", 32), audience: safeAudience,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }).select("*").single();
      if (error || !data) return json(500, { ok: false, error: "انتشار استوری انجام نشد." });
      return json(201, { ok: true, story: data });
    }

    if (path === "/social/stories/view" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const storyId = safeText(body.storyId, 64);
      const { data: story } = await supabase.from("vivo_stories").select("id,author_id,audience,expires_at,deleted_at").eq("id", storyId).maybeSingle();
      if (!story || story.deleted_at || new Date(story.expires_at).getTime() <= Date.now()) return json(404, { ok: false, error: "استوری در دسترس نیست." });
      const blocked = await blockedUsers(userId);
      if (story.author_id !== userId && blocked.has(story.author_id)) return json(404, { ok: false, error: "استوری در دسترس نیست." });
      const { data: storyAuthor } = await supabase.from("vivo_users").select("is_private").eq("id", story.author_id).maybeSingle();
      const followsAuthor = story.author_id === userId ? true : await followsUser(userId, story.author_id);
      if (story.author_id !== userId && (story.audience === "private" || ((story.audience === "followers" || storyAuthor?.is_private) && !followsAuthor))) return json(403, { ok: false, error: "مشاهده این استوری مجاز نیست." });
      const { error } = await supabase.from("vivo_story_views").upsert({ story_id: storyId, viewer_id: userId, viewed_at: new Date().toISOString() }, { onConflict: "story_id,viewer_id" });
      if (error) return json(500, { ok: false, error: "ثبت بازدید استوری انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/social/notifications" && req.method === "GET") {
      const { data, error } = await supabase.from("vivo_notifications").select("*")
        .eq("recipient_id", userId).order("created_at", { ascending: false }).limit(50);
      if (error) return json(500, { ok: false, error: "دریافت اعلان‌ها ناموفق بود." });
      const actorIds = [...new Set((data || []).map((x: any) => x.actor_id).filter(Boolean))];
      const actors = actorIds.length ? await supabase.from("vivo_users").select("id,display_name,username,avatar_url").in("id", actorIds) : { data: [], error: null };
      const actorMap = new Map((actors.data || []).map((x: any) => [x.id, x]));
      return json(200, { ok: true, notifications: (data || []).map((x: any) => ({ ...x, actor: actorMap.get(x.actor_id) || null })) });
    }

    if (path === "/social/notifications/read" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      let query = supabase.from("vivo_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", userId).is("read_at", null);
      if (body.id) query = query.eq("id", safeText(body.id, 64));
      const { error } = await query;
      if (error) return json(500, { ok: false, error: "به‌روزرسانی اعلان انجام نشد." });
      return json(200, { ok: true });
    }

    if (path === "/social/block" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const targetId = safeText(body.userId, 64);
      if (!targetId || targetId === userId) return json(400, { ok: false, error: "کاربر مقصد معتبر نیست." });
      const { data: target } = await supabase.from("vivo_users").select("id").eq("id", targetId).maybeSingle();
      if (!target) return json(404, { ok: false, error: "کاربر پیدا نشد." });
      const { error } = await supabase.from("vivo_blocks").upsert({ blocker_id: userId, blocked_id: targetId }, { onConflict: "blocker_id,blocked_id" });
      if (error) return json(500, { ok: false, error: "مسدودسازی انجام نشد." });
      await supabase.from("vivo_follows").delete().or("and(follower_id.eq." + userId + ",following_id.eq." + targetId + "),and(follower_id.eq." + targetId + ",following_id.eq." + userId + ")");
      return json(200, { ok: true });
    }

    if (path === "/social/report" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const targetType = safeText(body.targetType, 20);
      const targetId = safeText(body.targetId, 64);
      const reason = safeText(body.reason, 100).trim();
      const details = safeText(body.details, 1500);
      if (!["user", "post", "story", "comment", "message"].includes(targetType) || !targetId || reason.length < 2) {
        return json(400, { ok: false, error: "اطلاعات گزارش کامل نیست." });
      }
      const { error } = await supabase.from("vivo_reports").insert({ reporter_id: userId, target_type: targetType, target_id: targetId, reason, details });
      if (error) return json(500, { ok: false, error: "ثبت گزارش انجام نشد." });
      return json(201, { ok: true });
    }

    if (path === "/profile" && req.method === "GET") {
      const { data, error } = await supabase.from("vivo_users")
        .select("id,phone,display_name,username,bio,avatar_url,is_private,created_at")
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
      if (typeof body.isPrivate === "boolean") update.is_private = body.isPrivate;
      const { data, error } = await supabase.from("vivo_users")
        .update(update).eq("id", userId)
        .select("id,phone,display_name,username,bio,avatar_url,is_private,created_at").single();
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
