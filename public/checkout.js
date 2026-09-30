/* Method Machine Studio — shared checkout helper for the landing page and the Institute.
   Prices come from /api/prices (the Worker is the single source of truth); checkout is
   created server-side at /api/checkout and the visitor is sent to Stripe's hosted page. */
(function () {
  "use strict";
  var FALLBACK = {
    currencies: { usd: { symbol: "$", label: "USD" }, eur: { symbol: "€", label: "EUR" }, gbp: { symbol: "£", label: "GBP" }, inr: { symbol: "₹", label: "INR" } },
    plans: {
      scholar: { name: "Scholar", monthly: { usd: 19, eur: 18, gbp: 15, inr: 999 }, annual: { usd: 162, eur: 153, gbp: 128, inr: 8492 } },
      company: { name: "Company", monthly: { usd: 49, eur: 45, gbp: 39, inr: 2499 }, annual: { usd: 417, eur: 383, gbp: 332, inr: 21242 } },
      founder: { name: "Founder", monthly: { usd: 99, eur: 92, gbp: 79, inr: 4999 }, annual: { usd: 842, eur: 782, gbp: 672, inr: 42492 } }
    },
    enabled: false, portalUrl: ""
  };
  var KEY = "mms_currency", IKEY = "mms_interval";
  var table = FALLBACK, ready = null, listeners = [];

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function guessCurrency() {
    var tz = "", lang = (navigator.language || "").toLowerCase();
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta" || /-in$/.test(lang)) return "inr";
    if (tz === "Europe/London" || /-gb$/.test(lang)) return "gbp";
    if (/^Europe\//.test(tz)) return "eur";
    return "usd";
  }

  var MMS = {
    currency: read(KEY) || guessCurrency(),
    interval: read(IKEY) === "year" ? "year" : "month",
    load: function () {
      if (!ready) {
        ready = fetch("/api/prices", { headers: { Accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : FALLBACK; })
          .catch(function () { return FALLBACK; })
          .then(function (t) { table = t && t.plans ? t : FALLBACK; if (!table.currencies[MMS.currency]) MMS.currency = "usd"; notify(); return table; });
      }
      return ready;
    },
    table: function () { return table; },
    setCurrency: function (c) { if (table.currencies[c]) { MMS.currency = c; store(KEY, c); notify(); } },
    setInterval: function (i) { MMS.interval = i === "year" ? "year" : "month"; store(IKEY, MMS.interval); notify(); },
    onChange: function (fn) { listeners.push(fn); },
    /* amount the visitor pays per billing period, and the per-month equivalent */
    price: function (plan) {
      var p = table.plans[plan]; if (!p) return null;
      var m = p.monthly[MMS.currency]; if (m == null) return null;
      var yr = p.annual && p.annual[MMS.currency];
      var perPeriod = MMS.interval === "year" ? yr : m;
      return { amount: perPeriod, monthly: m, annual: yr, save: Math.round((1 - yr / (m * 12)) * 100), currency: MMS.currency };
    },
    format: function (amount, currency) {
      currency = currency || MMS.currency;
      try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(amount); }
      catch (e) { return (table.currencies[currency] || {}).symbol + amount; }
    },
    /* how much the annual plan saves against twelve monthly payments, in whole percent */
    annualSaving: function () {
      var p = table.plans.scholar, m = p && p.monthly.usd, y = p && p.annual && p.annual.usd;
      return m && y ? Math.round((1 - y / (m * 12)) * 100) : 0;
    },
    /* start Stripe Checkout; resolves with an error message when it cannot */
    start: function (plan, opts) {
      opts = opts || {};
      return fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plan: plan, interval: MMS.interval, currency: MMS.currency, email: opts.email || "", roll: opts.roll || "", promo: (opts.promo || "").trim() })
      })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (j) {
          if (j && j.ok && j.url) { window.location.href = j.url; return null; }
          if (j && j.error === "payments_unavailable") return "Payments open at launch. Join the waitlist and we'll email you the moment checkout is live.";
          if (j && j.error === "invalid_promo") return "That promo code isn't valid or has expired. Check it, or clear the box to continue without one.";
          if (j && j.error === "promo_not_applicable") return "That promo code doesn't apply to this plan or billing period.";
          return "Checkout couldn't start just now. Please try again in a minute.";
        })
        .catch(function () { return "Checkout couldn't start. Check your connection and try again."; });
    }
  };
  function notify() { listeners.forEach(function (fn) { try { fn(MMS); } catch (e) {} }); }
  window.MMS = MMS;
})();
