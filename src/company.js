// Method Machine Studio — the member home ("the company").
// One app, four plans: the plan is a field on the member and every gate below is
// enforced here, on the server, before anything is read back or written.
// Nothing in this module submits an application anywhere. "Open the site" writes a
// ledger line and redirects the member's own browser to the official URL; there are
// no stored passwords, no sessions for other sites and no batch or scheduled opens.

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

export const CAST = [
  { id: "director", name: "Director" },
  { id: "hagen", name: "Hagen" },
  { id: "stanislavski", name: "Stanislavski" },
  { id: "meisner", name: "Meisner" },
  { id: "strasberg", name: "Strasberg" },
  { id: "adler", name: "Adler" },
  { id: "chekhov", name: "Chekhov" },
];
const METHODS = CAST.filter((c) => c.id !== "director").map((c) => c.id);

export const TRACKS = [
  { id: "actor", name: "Actor" },
  { id: "writer", name: "Writer / Filmmaker" },
  { id: "engineer", name: "Engineer / Tech" },
  { id: "entrepreneur", name: "Entrepreneur" },
  { id: "solver", name: "Problem-Solver" },
];

// stripe: the checkout plan a paid member arrives with (src/payments.js); Audition is free.
export const PLANS = {
  audition: { name: "Audition", price: 0, stripe: null, cast: ["director", "hagen"], tracks: "none", community: "Read-only", packs: 0, packet: false, handoff: false, verified: false, business: false, group: false, founding: false },
  performer: { name: "Performer", price: 19, stripe: "scholar", cast: "all", tracks: "one", community: "Your track only", packs: 0, packet: true, handoff: false, verified: false, business: false, group: false, founding: false },
  company: { name: "Company", price: 49, stripe: "company", cast: "all", tracks: "all", community: "Every track", packs: 2, packet: true, handoff: true, verified: true, business: false, group: false, founding: false },
  "all-access": { name: "All-Access", price: 99, stripe: "founder", cast: "all", tracks: "all", community: "Every track", packs: 2, packet: true, handoff: true, verified: true, business: true, group: true, founding: true },
};
const NEXT_PLAN_FOR = { packet: "performer", handoff: "company", business: "all-access", group: "all-access" };

export const SITES = [
  { id: "commonapp", group: "School", name: "Common App", url: "https://www.commonapp.org/", line: "One application, many colleges. Not a blast.",
    must: "You submit to each school yourself, one at a time." },
  { id: "coalition", group: "School", name: "Coalition on Scoir", url: "https://www.coalitionforcollegeaccess.org/apply-coalition-on-scoir", line: "Coalition schools only.",
    must: "You submit to each school yourself, one at a time." },
  { id: "superprof", group: "Tutoring", name: "Superprof", url: "https://www.superprof.com/tutor/", line: "A free tutor ad. Students contact the member. This is not auto-apply.",
    must: "You publish an ad, and students write to you first." },
  { id: "simplify", group: "Work", name: "Simplify", url: "https://simplify.jobs/copilot", line: "Autofill. The member still submits.",
    must: "You still click submit on every application yourself." },
  { id: "lazyapply", group: "Work", name: "LazyApply", url: "https://lazyapply.com/", line: "Submits on Greenhouse, Dice, Indeed, and ZipRecruiter.",
    must: "This tool can submit applications without another click inside that tool. You are choosing to open it." },
  { id: "sonara", group: "Work", name: "Sonara", url: "https://www.sonara.ai/", line: "Finds matches and submits.",
    must: "This tool can submit applications without another click inside that tool. You are choosing to open it." },
  { id: "loopcv", group: "Work", name: "LoopCV", url: "https://www.loopcv.pro/", line: "Auto-applies, or holds matches for approval.",
    must: "This tool can submit applications without another click inside that tool. You are choosing to open it." },
];

const BUILD_ROWS = [
  { id: "discord", name: "Discord", url: "https://discord.com/", line: "Build your own server, then paste the invite link.", hosts: ["discord.gg", "discord.com"] },
  { id: "skool", name: "Skool", url: "https://www.skool.com/", line: "Build your own classroom, then paste the classroom link.", hosts: ["skool.com"] },
];

// One fixture member per plan, so each gate can be rendered and checked.
const FIXTURES = [
  { id: "fx-audition", name: "Ada Fixture", plan: "audition", track: null, direction: "Read the circumstances before the first line.", holder: "director" },
  { id: "fx-performer", name: "Ben Fixture", plan: "performer", track: "writer", direction: "Break the second act into beats before drafting.", holder: "stanislavski" },
  { id: "fx-company", name: "Cy Fixture", plan: "company", track: "engineer", direction: "Specify the API before writing a line of it.", holder: "adler" },
  { id: "fx-all-access", name: "Dee Fixture", plan: "all-access", track: "entrepreneur", direction: "Frame the problem the pitch solves, then cut it to one page.", holder: "meisner",
    group_name: "Dee's Room", discord: "https://discord.gg/mms-fixture", skool: "https://www.skool.com/mms-fixture" },
];

let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS studio_members (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL, track TEXT, direction TEXT, holder TEXT, handoff TEXT, packet TEXT, group_name TEXT, discord TEXT, skool TEXT, updated_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS connection_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, member_id TEXT NOT NULL, site TEXT NOT NULL, plan TEXT NOT NULL)"),
    ...FIXTURES.map((f) =>
      env.DB.prepare("INSERT OR IGNORE INTO studio_members (id, name, plan, track, direction, holder, group_name, discord, skool, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(f.id, f.name, f.plan, f.track, f.direction, f.holder, f.group_name || null, f.discord || null, f.skool || null, new Date().toISOString())
    ),
  ]);
  ready = true;
}

const castOpen = (plan, id) => plan.cast === "all" || plan.cast.includes(id);
const trackOpen = (plan, member, id) => plan.tracks === "all" || (plan.tracks === "one" && member.track === id);
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const text = (v, max) => String(v ?? "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, max);
function httpsUrl(v, hosts) {
  try {
    const u = new URL(String(v || "").trim());
    if (u.protocol !== "https:") return null;
    if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) return null;
    return u.toString().slice(0, 300);
  } catch { return null; }
}

// What the member's plan lets them see, computed from the data model only.
function view(m) {
  const plan = PLANS[m.plan];
  const lockedBy = (gate) => PLANS[NEXT_PLAN_FOR[gate]].name;
  const packet = plan.packet ? parse(m.packet) : null;
  const handoff = plan.handoff ? parse(m.handoff) : null;
  return {
    member: { id: m.id, name: m.name, track: m.track },
    plan: { id: m.plan, name: plan.name, price: plan.price, verified: plan.verified, founding: plan.founding, community: plan.community, packs: plan.packs },
    cast: CAST.map((c) => ({ ...c, open: castOpen(plan, c.id), opens: castOpen(plan, c.id) ? null : "Performer" })),
    tracks: TRACKS.map((t) => ({ ...t, open: trackOpen(plan, m, t.id), opens: trackOpen(plan, m, t.id) ? null : plan.tracks === "one" ? "Company" : "Performer" })),
    direction: { line: m.direction || "", holder: m.holder || "director", handoff },
    handoff: plan.handoff ? { open: true } : { open: false, line: "Handoffs unlock on Company." },
    connections: {
      canPrepare: plan.packet,
      locked: plan.packet ? null : `Preparing a packet starts on ${lockedBy("packet")}.`,
      packet,
      sites: SITES.map((s) => ({ id: s.id, group: s.group, name: s.name, url: s.url, line: s.line, must: s.must, open: plan.packet, opens: plan.packet ? null : lockedBy("packet") })),
    },
    business: plan.business ? { open: true, title: "Business", body: "Suite tools are not named yet." } : { open: false, line: "All-Access." },
    group: plan.group
      ? { open: true, name: m.group_name || "", members: [], rows: BUILD_ROWS.map((r) => ({ id: r.id, name: r.name, url: r.url, line: r.line, saved: m[r.id] || null })) }
      : { open: false, line: "All-Access.", rows: BUILD_ROWS.map((r) => ({ id: r.id, name: r.name, line: r.line, open: false })) },
  };
}

async function load(env, id) {
  if (!id || typeof id !== "string") return null;
  const m = await env.DB.prepare("SELECT * FROM studio_members WHERE id = ?").bind(id.slice(0, 64)).first();
  return m && PLANS[m.plan] ? m : null;
}

async function body(request) {
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) return (await request.json().catch(() => ({}))) || {};
  const f = await request.formData().catch(() => null);
  return f ? Object.fromEntries(f) : {};
}

const save = (env, id, sets, values) =>
  env.DB.prepare(`UPDATE studio_members SET ${sets.map((s) => s + " = ?").join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...values, new Date().toISOString(), id).run();

export async function handleCompany(request, env, pathname) {
  if (!pathname.startsWith("/api/company")) return null;
  if (!env.DB) return json(503, { ok: false, error: "storage_unavailable" });
  await ensure(env);
  const url = new URL(request.url);

  if (pathname === "/api/company" && request.method === "GET") {
    if (!url.searchParams.get("member")) return json(200, { ok: true, fixtures: FIXTURES.map((f) => ({ id: f.id, plan: PLANS[f.plan].name })) });
    const m = await load(env, url.searchParams.get("member"));
    return m ? json(200, { ok: true, ...view(m) }) : json(404, { ok: false, error: "unknown_member" });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });

  const b = await body(request);
  const m = await load(env, b.member);
  if (!m) return json(404, { ok: false, error: "unknown_member" });
  const plan = PLANS[m.plan];
  const deny = (gate) => json(403, { ok: false, error: "plan_locked", opens: PLANS[NEXT_PLAN_FOR[gate]].name });

  switch (pathname) {
    // Today's direction: the line, and which open cast member is holding it.
    case "/api/company/direction": {
      const line = text(b.line, 280);
      const holder = String(b.holder || "director");
      if (!line) return json(400, { ok: false, error: "empty_direction" });
      if (!CAST.some((c) => c.id === holder) || !castOpen(plan, holder)) return json(403, { ok: false, error: "cast_locked", opens: "Performer" });
      await save(env, m.id, ["direction", "holder"], [line, holder]);
      break;
    }
    // A packet is the member's own material; no file, no password, no third-party login.
    case "/api/company/packet": {
      if (!plan.packet) return deny("packet");
      const packet = { name: text(b.name, 120), contact: text(b.contact, 160), work: httpsUrl(b.work), track: String(b.track || ""), note: text(b.note, 400) };
      if (!packet.name || !packet.contact || !packet.work || !packet.note) return json(400, { ok: false, error: "incomplete_packet" });
      if (!TRACKS.some((t) => t.id === packet.track) || !trackOpen(plan, m, packet.track)) return json(403, { ok: false, error: "track_locked" });
      await save(env, m.id, ["packet"], [JSON.stringify(packet)]);
      break;
    }
    // Review passed: one site, one ledger line, then the member's browser goes to the official URL.
    case "/api/company/open": {
      const site = SITES.find((s) => s.id === b.site);
      if (!site) return json(404, { ok: false, error: "unknown_site" });
      if (!plan.packet) return deny("packet");
      if (!parse(m.packet)) return json(409, { ok: false, error: "no_packet" });
      await env.DB.prepare("INSERT INTO connection_ledger (at, member_id, site, plan) VALUES (?, ?, ?, ?)")
        .bind(new Date().toISOString(), m.id, site.name, plan.name).run();
      return new Response(null, { status: 303, headers: { Location: site.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }
    // Handoff: Director starts; the member sets who has it and who is next.
    case "/api/company/handoff": {
      if (!plan.handoff) return deny("handoff");
      const has = String(b.has || ""), next = String(b.next || "");
      if (!METHODS.includes(has) || !METHODS.includes(next)) return json(400, { ok: false, error: "bad_handoff" });
      await save(env, m.id, ["handoff"], [JSON.stringify({ started: "director", has, next })]);
      break;
    }
    case "/api/company/group": {
      if (!plan.group) return deny("group");
      const name = text(b.name, 80);
      if (!name) return json(400, { ok: false, error: "empty_name" });
      await save(env, m.id, ["group_name"], [name]);
      break;
    }
    case "/api/company/link": {
      if (!plan.group) return deny("group");
      const row = BUILD_ROWS.find((r) => r.id === b.kind);
      if (!row) return json(404, { ok: false, error: "unknown_row" });
      const link = httpsUrl(b.url, row.hosts);
      if (!link) return json(400, { ok: false, error: "bad_link" });
      await save(env, m.id, [row.id], [link]);
      break;
    }
    default:
      return json(404, { ok: false, error: "not_found" });
  }
  return json(200, { ok: true, ...view(await load(env, m.id)) });
}
