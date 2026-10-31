// Method Machine Studio — Stripe payments for the Institute membership plans.
//
// Routes (wired up in worker.js):
//   GET  /api/prices            plan/price table for the pages (single source of truth for amounts)
//   POST /api/checkout          { plan, interval, currency, email? } -> { url } of a Stripe Checkout Session
//   GET  /api/checkout-status   ?session_id=cs_... -> { paid, plan, interval, email }
//   POST /api/stripe-webhook    Stripe events -> members table in D1
//
// Secrets (Cloudflare → Worker → Settings → Variables and Secrets):
//   STRIPE_SECRET_KEY       sk_test_... while testing, sk_live_... when live
//   STRIPE_WEBHOOK_SECRET   whsec_... from the webhook endpoint in the Stripe dashboard
// Optional plain variables:
//   STRIPE_PORTAL_URL       the customer portal login link from Stripe (Settings → Customer portal)
//   STRIPE_AUTOMATIC_TAX    "1" once Stripe Tax is set up

const STRIPE_API = "https://api.stripe.com/v1/";
const STRIPE_VERSION = "2024-06-20";

// Monthly prices in each currency (major units). Annual = 10 × monthly, less a further 15%,
// rounded to whole units (ANNUAL_FACTOR below).
// Change amounts here: new checkouts create a new Stripe price automatically because the
// amount is part of the lookup key.
export const CURRENCIES = {
  usd: { symbol: "$", label: "USD" },
  eur: { symbol: "€", label: "EUR" },
  gbp: { symbol: "£", label: "GBP" },
  inr: { symbol: "₹", label: "INR" },
};
export const PLANS = {
  scholar: { name: "Scholar", sub: "Premium courses", monthly: { usd: 19, eur: 18, gbp: 15, inr: 999 } },
  company: { name: "Company", sub: "Teaching Assistant + the company", monthly: { usd: 49, eur: 45, gbp: 39, inr: 2499 } },
  founder: { name: "Founder", sub: "Found your own classroom", monthly: { usd: 99, eur: 92, gbp: 79, inr: 4999 } },
};
const INTERVALS = ["month", "year"];
const ANNUAL_FACTOR = 10 * 0.85;   // 8.5 months' price for a year: about 29% below paying monthly

function annualFor(monthly) {
  return Math.round(monthly * ANNUAL_FACTOR);
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

function amountFor(plan, interval, currency) {
  const m = PLANS[plan]?.monthly?.[currency];
  if (!m) return null;
  return interval === "year" ? annualFor(m) : m;
}

// Stripe takes form-encoded bodies with bracketed keys: a[b][0][c]=v
function formEncode(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(env, method, path, params) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_VERSION },
  };
  let url = STRIPE_API + path;
  if (params && method === "GET") url += "?" + formEncode(params).toString();
  else if (params) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = formEncode(params).toString();
  }
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Stripe ${res.status}`);
    err.status = res.status;
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

// Find the price for plan × interval × currency × amount, creating product and price on first use.
async function ensurePrice(env, plan, interval, currency) {
  const amount = amountFor(plan, interval, currency);
  const lookup = `mms_${plan}_${interval}_${currency}_${amount}`;
  const found = await stripe(env, "GET", "prices", { "lookup_keys[]": lookup, active: "true", limit: 1 });
  if (found.data?.length) return found.data[0].id;

  const productId = `mms_${plan}`;
  try {
    await stripe(env, "GET", `products/${productId}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    await stripe(env, "POST", "products", {
      id: productId,
      name: `Method Machine Studio — ${PLANS[plan].name}`,
      description: `The Method Institute · ${PLANS[plan].sub}`,
      metadata: { plan },
    });
  }
  const price = await stripe(env, "POST", "prices", {
    product: productId,
    currency,
    unit_amount: amount * 100, // all four currencies use two decimal places
    recurring: { interval },
    lookup_key: lookup,
    transfer_lookup_key: "true",
    nickname: `${PLANS[plan].name} · ${interval === "year" ? "annual" : "monthly"} · ${currency.toUpperCase()}`,
    metadata: { plan, interval },
  });
  return price.id;
}

function pricesTable(env) {
  return {
    currencies: CURRENCIES,
    plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, {
      name: p.name, sub: p.sub, monthly: p.monthly,
      annual: Object.fromEntries(Object.entries(p.monthly).map(([c, m]) => [c, annualFor(m)])),
    }])),
    enabled: !!env.STRIPE_SECRET_KEY,
    portalUrl: env.STRIPE_PORTAL_URL || "",
  };
}

async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) return json(503, { ok: false, error: "payments_unavailable" });
  let body = {};
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_request" }); }
  const plan = String(body.plan || "");
  const interval = INTERVALS.includes(body.interval) ? body.interval : "month";
  const currency = CURRENCIES[body.currency] ? body.currency : "usd";
  if (!PLANS[plan]) return json(400, { ok: false, error: "bad_plan" });
  const email = String(body.email || "").trim();

  // Promo code typed on the site: checked against Stripe before the visitor leaves the page.
  // With no code, Stripe's own "Add promotion code" field stays available on the checkout page.
  const promo = String(body.promo || "").trim();
  let discounts;
  if (promo) {
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(promo)) return json(400, { ok: false, error: "invalid_promo" });
    const found = await stripe(env, "GET", "promotion_codes", { code: promo, active: "true", limit: 1 });
    if (!found.data?.length) return json(400, { ok: false, error: "invalid_promo" });
    discounts = [{ promotion_code: found.data[0].id }];
  }

  const origin = new URL(request.url).origin;
  const price = await ensurePrice(env, plan, interval, currency);
  let session;
  try {
    session = await stripe(env, "POST", "checkout/sessions", {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#pricing`,
    allow_promotion_codes: discounts ? undefined : "true",
    discounts,
    billing_address_collection: "auto",
    customer_email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    client_reference_id: String(body.roll || "").slice(0, 60) || undefined,
    metadata: { plan, interval, currency },
    subscription_data: { metadata: { plan, interval, currency } },
    automatic_tax: env.STRIPE_AUTOMATIC_TAX === "1" ? { enabled: "true" } : undefined,
    });
  } catch (e) {
    // A real code that Stripe refuses for this plan (product restriction, minimum amount, first-time only…)
    if (discounts && e.status === 400) return json(400, { ok: false, error: "promo_not_applicable" });
    throw e;
  }
  return json(200, { ok: true, url: session.url });
}

async function checkoutStatus(request, env) {
  if (!env.STRIPE_SECRET_KEY) return json(503, { ok: false, error: "payments_unavailable" });
  const id = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json(400, { ok: false, error: "bad_session" });
  const s = await stripe(env, "GET", `checkout/sessions/${id}`);
  return json(200, {
    ok: true,
    paid: s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required"),
    plan: s.metadata?.plan || "",
    interval: s.metadata?.interval || "",
    email: s.customer_details?.email || "",
  });
}

// ---- webhooks ----

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const t = parseInt(parts.t, 10);
  const sigs = header.split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${t}.${payload}`);
  for (const sig of sigs) {
    if (!/^[0-9a-f]{64}$/.test(sig)) continue;
    if (await crypto.subtle.verify("HMAC", key, hexToBytes(sig), data)) return true;
  }
  return false;
}

async function upsertMember(env, m) {
  await env.DB.prepare(
    `INSERT INTO members (subscription_id, customer_id, email, plan, interval, currency, status, current_period_end, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(subscription_id) DO UPDATE SET
       customer_id = COALESCE(excluded.customer_id, customer_id),
       email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE email END,
       plan = CASE WHEN excluded.plan <> '' THEN excluded.plan ELSE plan END,
       interval = CASE WHEN excluded.interval <> '' THEN excluded.interval ELSE interval END,
       currency = CASE WHEN excluded.currency <> '' THEN excluded.currency ELSE currency END,
       status = excluded.status,
       current_period_end = COALESCE(excluded.current_period_end, current_period_end),
       updated_at = excluded.updated_at`
  ).bind(
    m.subscription_id, m.customer_id || null, m.email || "", m.plan || "", m.interval || "", m.currency || "",
    m.status, m.current_period_end || null, new Date().toISOString()
  ).run();
}

async function stripeWebhook(request, env) {
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return json(400, { ok: false, error: "bad_signature" });
  }
  const event = JSON.parse(payload);
  const o = event.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed":
      if (o.mode === "subscription" && o.subscription) {
        await upsertMember(env, {
          subscription_id: o.subscription, customer_id: o.customer, email: o.customer_details?.email || o.customer_email,
          plan: o.metadata?.plan, interval: o.metadata?.interval, currency: o.currency, status: "active",
        });
      }
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const periodEnd = o.current_period_end || o.items?.data?.[0]?.current_period_end;
      await upsertMember(env, {
        subscription_id: o.id, customer_id: o.customer, plan: o.metadata?.plan, interval: o.metadata?.interval,
        currency: o.currency, status: event.type === "customer.subscription.deleted" ? "canceled" : o.status,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      });
      break;
    }
  }
  return json(200, { received: true });
}

// Returns a Response for payment routes, or null if the path is not one of ours.
export async function handlePayments(request, env, pathname) {
  try {
    if (pathname === "/api/prices" && request.method === "GET") return json(200, pricesTable(env));
    if (pathname === "/api/checkout" && request.method === "POST") return await createCheckout(request, env);
    if (pathname === "/api/checkout-status" && request.method === "GET") return await checkoutStatus(request, env);
    if (pathname === "/api/stripe-webhook" && request.method === "POST") return await stripeWebhook(request, env);
  } catch (err) {
    console.error("payments error", pathname, err.message);
    return json(502, { ok: false, error: "payment_provider_error" });
  }
  if (["/api/prices", "/api/checkout", "/api/checkout-status", "/api/stripe-webhook"].includes(pathname)) {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return null;
}
