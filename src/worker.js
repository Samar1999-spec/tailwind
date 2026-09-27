// Method Machine Studio — Cloudflare Worker.
// Serves the static site from ./public and handles form posts to /submit.php
// (the same path the PHP host uses, so the pages work unchanged on either host).
// Submissions go to the D1 database bound as DB. The Stage 1 answer key is read
// from the ANSWER_KEY secret and never reaches the browser or the public repo.

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strip control characters and cap length; neutralise spreadsheet formula injection on export.
function clean(form, key, max = 500) {
  let v = String(form.get(key) ?? "").trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, max);
  if (v && "=+-@".includes(v[0])) v = "'" + v;
  return v;
}

// Every number in a free-text answer; "3/8" -> 0.375, "56.6%" -> 0.566, "10,975.61" -> 10975.61.
function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(/(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*(%)?/g)) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (m[2] && parseFloat(m[2]) !== 0) v /= parseFloat(m[2]);
    if (m[3]) v /= 100;
    out.push(v);
  }
  return out;
}

function scoreAttempt(answers, key) {
  if (!key) {
    return { character: "", hardFails: "", aptitude: "", report: "Auto-scoring off: the ANSWER_KEY secret is not set.\n" };
  }
  const pick = (id) => String(answers[id] ?? "").trim().toUpperCase();

  // Character gate
  let preferred = 0, seen = 0;
  const fails = [], lines = [];
  for (const [id, k] of Object.entries(key.character)) {
    const a = pick(id);
    if (!a) { lines.push(`  ${id}: —`); continue; }
    seen++;
    if (a === k.preferred) preferred++;
    const tag = a === k.preferred ? "preferred" : k.hard_fail.includes(a) ? "HARD FAIL" : "other";
    if (tag === "HARD FAIL") fails.push(id);
    lines.push(`  ${id}: ${a} (${tag})`);
  }
  const flags = [];
  if (["A", "D"].includes(pick("A1"))) flags.push(`A1 ${pick("A1")}: hard fail if no discomfort shown elsewhere in the set`);
  if (pick("A1") === "C" && pick("A8") === "C") flags.push("C on both A1 and A8: pattern of aestheticized untruth (hard fail per rubric)");
  const theater = ["A3", "A4", "A10", "A11"].filter((id) => ["C", "D"].includes(pick(id)));
  if (theater.length >= 3) flags.push(`C/D cluster on ${theater.join(", ")}: "founder-max" theater`);
  if (pick("A11") === "D") flags.push("A11 D: honesty-as-brand (soft flag)");
  const gate = fails.length <= 1 && theater.length < 3 ? "PASS (pending portrait)" : "HOLD";

  // Aptitude, auto-markable items only
  const bySec = {}, marks = [];
  let got = 0, max = 0;
  const tally = (id, right) => {
    const s = (bySec[id[0]] ??= [0, 0]);
    s[1]++; max++;
    if (right) { s[0]++; got++; }
  };
  for (const [id, ok] of Object.entries(key.mcq)) {
    const a = pick(id), right = a !== "" && ok.includes(a);
    tally(id, right);
    marks.push(`  ${id}: ${a || "—"} ${right ? "✓" : "✗"} (key ${ok.join("/")})`);
  }
  for (const [id, targets] of Object.entries(key.numeric)) {
    const text = String(answers[id] ?? ""), nums = numbersIn(text);
    const right = text !== "" && targets.every(([want, tol]) => nums.some((n) => Math.abs(n - want) <= tol));
    tally(id, right);
    marks.push(`  ${id}: ${text ? `"${text.slice(0, 60)}"` : "—"} ${right ? "✓" : "✗"}`);
  }
  const secLine = Object.keys(bySec).sort().map((s) => `${s} ${bySec[s][0]}/${bySec[s][1]}`).join("  ");
  const pct = max ? Math.round((100 * got) / max) : 0;
  const manual = key.manual.map((id) => `  ${id}: ${String(answers[id] ?? "").trim() || "(blank)"}`);

  const report =
    `CHARACTER GATE (Section A): ${gate}\n` +
    `Preferred answers: ${preferred} / 12 (answered ${seen})\n` +
    `Hard fails: ${fails.length ? fails.join(", ") : "none"}\n` +
    (flags.length ? `Flags:\n  ${flags.join("\n  ")}\n` : "") +
    lines.join("\n") + "\n\n" +
    `APTITUDE, auto-marked items only: ${got} / ${max} (${pct}%)\n${secLine}\n` +
    "Short answers are matched on the numbers only; confirm them and score the working (0–2) by hand.\n" +
    marks.join("\n") + "\n\n" +
    "FOR MANUAL SCORING\n" + manual.join("\n") + "\n" +
    "Working for each item is in the answers column (keys ending in ~work).\n";

  return { character: `${preferred}/12`, hardFails: fails.length ? fails.join(" ") : "none", aptitude: `${got}/${max}`, report };
}

async function handleSubmit(request, env) {
  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: "bad_request" }); }

  // Honeypot: bots fill the hidden "website" field. Pretend success so they move on.
  if (String(form.get("website") ?? "").trim() !== "") return json(200, { ok: true });

  const email = String(form.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) return json(422, { ok: false, error: "invalid_email" });
  if (!env.DB) return json(500, { ok: false, error: "storage_unavailable" });

  const type = form.get("type") === "application" ? "application" : "waitlist";
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const when = new Date().toISOString();

  // Simple per-IP rate limit: at most 10 submissions per 10 minutes.
  const since = new Date(Date.now() - 600_000).toISOString();
  const { n } = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM waitlist WHERE ip = ?1 AND submitted_at > ?2) + (SELECT COUNT(*) FROM applications WHERE ip = ?1 AND submitted_at > ?2) AS n"
  ).bind(ip, since).first();
  if (n >= 10) return json(429, { ok: false, error: "rate_limited" });

  if (type === "waitlist") {
    await env.DB.prepare("INSERT INTO waitlist (submitted_at, email, page, ip, user_agent) VALUES (?, ?, ?, ?, ?)")
      .bind(when, email, clean(form, "page", 200), ip, (request.headers.get("User-Agent") || "").slice(0, 300)).run();
    return json(200, { ok: true });
  }

  let answers = {};
  try { const a = JSON.parse(String(form.get("answers") ?? "")); if (a && typeof a === "object") answers = a; } catch {}
  let key = null;
  try { key = env.ANSWER_KEY ? JSON.parse(env.ANSWER_KEY) : null; } catch {}
  const score = scoreAttempt(answers, key);

  await env.DB.prepare(
    `INSERT INTO applications (submitted_at, candidate, name, email, work, source, mode, timed_out, answered, focus_events,
       character_preferred, hard_fails, aptitude_auto, report, answers, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    when, clean(form, "candidate", 40), clean(form, "name", 200), email, clean(form, "work", 2000), clean(form, "source", 300),
    clean(form, "mode", 20), clean(form, "timed_out", 1), clean(form, "answered", 6), clean(form, "focus_events", 6),
    score.character, score.hardFails, score.aptitude, score.report, String(form.get("answers") ?? "").slice(0, 60000), ip
  ).run();
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/submit.php" || pathname === "/api/submit") {
      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
      try {
        return await handleSubmit(request, env);
      } catch (err) {
        console.error("submit failed", err);
        return json(500, { ok: false, error: "server_error" });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
