// Method Machine Studio — submissions viewer for the owner (/admin).
// Every /api/admin request must carry the ADMIN_PASSWORD secret as a Bearer token.
// Without that secret set, the endpoints refuse everything. Read-only: nothing here
// writes to or deletes from the database.

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" },
  });

// Tables the page may read, newest first by their time column.
const TABLES = {
  waitlist: { label: "Waitlist", time: "submitted_at", cols: ["id", "submitted_at", "email", "page", "ip", "user_agent"] },
  applications: { label: "Careers applications", time: "submitted_at", cols: ["id", "submitted_at", "candidate", "name", "email", "work", "source", "mode", "timed_out", "answered", "focus_events", "character_preferred", "hard_fails", "aptitude_auto", "report", "answers", "ip"] },
  institute_papers: { label: "Institute papers", time: "submitted_at", cols: ["id", "submitted_at", "roll", "name", "email", "track", "years", "dossier", "answers", "ip"] },
  members: { label: "Paid members", time: "updated_at", cols: ["subscription_id", "updated_at", "email", "plan", "interval", "currency", "status", "current_period_end", "customer_id"] },
  uploads: { label: "Uploads", time: "submitted_at", cols: ["id", "submitted_at", "slot", "name", "size", "r2_key", "ip"] },
};

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
}
// Compare fixed-length hashes so timing reveals nothing about the password.
async function same(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Slow down repeated wrong passwords from one address (per Worker instance).
const misses = new Map();
function throttled(ip) {
  const m = misses.get(ip);
  return m && m.count >= 5 && Date.now() - m.at < 10 * 60 * 1000;
}
function miss(ip) {
  const m = misses.get(ip);
  const fresh = !m || Date.now() - m.at > 10 * 60 * 1000;
  misses.set(ip, { count: fresh ? 1 : m.count + 1, at: Date.now() });
  if (misses.size > 5000) misses.clear();
}

export async function handleAdmin(request, env, pathname) {
  if (!pathname.startsWith("/api/admin")) return null;
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
  if (!env.ADMIN_PASSWORD) return json(503, { ok: false, error: "admin_not_configured" });
  if (!env.DB) return json(503, { ok: false, error: "storage_unavailable" });

  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (throttled(ip)) return json(429, { ok: false, error: "too_many_attempts" });
  const auth = request.headers.get("Authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !(await same(given, env.ADMIN_PASSWORD))) {
    miss(ip);
    await new Promise((r) => setTimeout(r, 400));
    return json(401, { ok: false, error: "unauthorized" });
  }
  misses.delete(ip);

  const url = new URL(request.url);

  // Counts and latest time for every table; a missing table reads as empty.
  if (pathname === "/api/admin/summary") {
    const out = {};
    for (const [name, t] of Object.entries(TABLES)) {
      try {
        const r = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(${t.time}) AS last FROM ${name}`).first();
        out[name] = { label: t.label, count: r?.n || 0, last: r?.last || null };
      } catch {
        out[name] = { label: t.label, count: 0, last: null };
      }
    }
    return json(200, { ok: true, tables: out });
  }

  if (pathname === "/api/admin/rows") {
    const name = url.searchParams.get("table") || "";
    const t = TABLES[name];
    if (!t) return json(404, { ok: false, error: "unknown_table" });
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "500", 10) || 500, 1), 1000);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
    try {
      const { results } = await env.DB.prepare(`SELECT ${t.cols.join(", ")} FROM ${name} ORDER BY ${t.time} DESC LIMIT ? OFFSET ?`).bind(limit, offset).all();
      const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first())?.n || 0;
      return json(200, { ok: true, table: name, label: t.label, cols: t.cols, rows: results || [], total, limit, offset });
    } catch {
      return json(200, { ok: true, table: name, label: t.label, cols: t.cols, rows: [], total: 0, limit, offset });
    }
  }

  return json(404, { ok: false, error: "not_found" });
}
