(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  const DEBUG = new URLSearchParams(location.search).get("fpdebug") === "1";
  const dlog = (...a) => DEBUG && console.log("[ForwardPerformance]", ...a);

  const SESSION_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    "sess_" + Math.random().toString(16).slice(2);

  let current = null;
  let routeId = 0;
  let lastUrl = location.href;

  /* =========================================================
     HELPERS
  ========================================================= */

  const nowISO = () => new Date().toISOString();
  const safe = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n) : null);

  function getNetworkType() {
    return navigator.connection?.effectiveType || null;
  }

  /* =========================================================
     PAYLOAD
  ========================================================= */

  function newPayload(kind) {
    routeId++;

    return {
      sessionId: SESSION_ID,
      routeId,
      kind,
      startedAt: nowISO(),

      page: {
        path: location.pathname || "/",
        url: location.href,
        referrer: lastUrl || null,
      },

      network: {
        type: getNetworkType(), // bv: "4g", "3g", "slow-2g"
      },

      metrics: {},

      endedAt: null,
      reason: null,
      _sent: false,
    };
  }

  /* =========================================================
     WEB VITALS
  ========================================================= */

  function loadWebVitals(cb) {
    if (window.webVitals) return cb();
    const s = document.createElement("script");
    s.src = "https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function bindVitals() {
    if (!current || !window.webVitals) return;

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    onCLS((m) => current && !current._sent && (current.metrics.CLS = +m.value.toFixed(4)));
    onINP((m) => current && !current._sent && (current.metrics.INP = safe(m.value)));
    onLCP((m) => current && !current._sent && (current.metrics.LCP = safe(m.value)));
    onFCP((m) => current && !current._sent && (current.metrics.FCP = safe(m.value)));
    onTTFB((m) => current && !current._sent && (current.metrics.TTFB = safe(m.value)));
  }

  /* =========================================================
     SEND
  ========================================================= */

  function send(reason) {
    if (!current || current._sent) return;

    current.reason = reason;
    current.endedAt = nowISO();
    current._sent = true;

    const payload = {
      sessionId: current.sessionId,
      routeId: current.routeId,
      kind: current.kind,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      reason: current.reason,
      page: current.page,
      network: current.network,
      metrics: current.metrics,
    };

    try {
      navigator.sendBeacon(API_ENDPOINT, JSON.stringify(payload));
    } catch {
      fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }

    dlog("sent", payload);
  }

  /* =========================================================
     SPA ROUTES
  ========================================================= */

  function onRouteChange(trigger) {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;

    send("route-change");

    lastUrl = newUrl;
    current = newPayload("spa");
    loadWebVitals(bindVitals);
  }

  function hookHistory() {
    const p = history.pushState;
    const r = history.replaceState;

    history.pushState = function () {
      p.apply(this, arguments);
      window.dispatchEvent(new Event("fp:route"));
    };

    history.replaceState = function () {
      r.apply(this, arguments);
      window.dispatchEvent(new Event("fp:route"));
    };

    window.addEventListener("fp:route", () => onRouteChange("history"));
    window.addEventListener("popstate", () => onRouteChange("popstate"));
    window.addEventListener("hashchange", () => onRouteChange("hashchange"));
  }

  /* =========================================================
     START
  ========================================================= */

  function start() {
    current = newPayload("load");
    loadWebVitals(bindVitals);
    hookHistory();

    window.addEventListener("pagehide", () => send("pagehide"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") send("hidden");
    });

    dlog("started");
  }

  start();
})();
