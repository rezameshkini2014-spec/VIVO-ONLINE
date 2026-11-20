const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Type": "application/json; charset=utf-8"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: HEADERS
  });
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1\/vivo-api/, "")
    .replace(/^\/vivo-api/, "") || "/";

  if (path === "/health") {
    if (req.method !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    return json(200, {
      ok: true,
      service: "VIVO Cloud API",
      version: "1.0.0",
      accountApi: "disabled"
    });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  return json(503, {
    ok: false,
    error: "احراز هویت ویوو تا تکمیل سامانه نشست امن غیرفعال است."
  });
});
