(function () {
  /* =========================================================
     CONFIG
  ========================================================= */

  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  // ✅ uit .env via Vite
  const BASE_API_URL = import.meta.env.VITE_API_URL;
  const SAMPLE_ENDPOINT = BASE_API_URL.replace(/\/$/, "") + "/sample-rate";

  const SESSION_KEY = "__fp_active";

  const DEBUG = new URLSearchParams(location.search).get("fpdebug") === "1";
  const dlog = (...a) => DEBUG && console.log("[ForwardPerformance]", ...a);

  let current = null;

  /* =========================================================
     HELPERS
  ========================================================= */

  const safe = (n) =>
    typeof n === "number" && isFinite(n) ? Math.round(n) : null;

  const decide = (rate) => Math.random() * 100 < rate;

  function getNetworkType() {
    return navigator.connection?.effectiveType || null;
  }

  function getDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    if (/ipad|tablet/.test(ua)) return "tablet";
    if (/mobi|android|iphone/.test(ua)) return "mobile";
    return "desktop";
  }

  function getBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes("Edg/")) return "Edge";
    if (ua.includes("Chrome/")) return "Chrome";
    if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
    if (ua.includes("Firefox/")) return "Firefox";
    return "Other";
  }

  /* =========================================================
     PAYLOAD
  ========================================================= */

  function newPayload() {
    return {
      url: location.href,
      networkType: getNetworkType(),
      browser: getBrowser(),
      deviceType: getDeviceType(),

      CLS: null,
      INP: null,
      LCP: null,
      FCP: null,
      TTFB: null,

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

    onCLS((m) => current && !current._sent && (current.CLS = +m.value.toFixed(4)));
    onINP((m) => current && !current._sent && (current.INP = safe(m.value)));
    onLCP((m) => current && !current._sent && (current.LCP = safe(m.value)));
    onFCP((m) => current && !current._sent && (current.FCP = safe(m.value)));
    onTTFB((m) => current && !current._sent && (current.TTFB = safe(m.value)));
  }

  /* =========================================================
     SEND
  ========================================================= */

  function send(reason) {
    if (!current || current._sent) return;

    current._sent = true;

    const payload = {
      url: current.url,
      networkType: current.networkType,
      browser: current.browser,
      deviceType: current.deviceType,

      CLS: current.CLS,
      INP: current.INP,
      LCP: current.LCP,
      FCP: current.FCP,
      TTFB: current.TTFB,
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

  function onRouteChange() {
    send("route-change");
    current = newPayload();
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

    window.addEventListener("fp:route", onRouteChange);
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("hashchange", onRouteChange);
  }

  /* =========================================================
     START
  ========================================================= */

  function start() {
    current = newPayload();
    loadWebVitals(bindVitals);
    hookHistory();

    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") send();
    });

    dlog("started");
  }

  /* =========================================================
     BOOT + SAMPLING
  ========================================================= */

  async function boot() {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored !== null) {
      if (stored === "1") start();
      return;
    }

    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 800);

      const res = await fetch(SAMPLE_ENDPOINT, {
        signal: ctrl.signal,
        cache: "no-store",
      });

      const data = await res.json();
      const rate = Number(data.sample_rate ?? data.value ?? 100);

      const active = decide(rate);
      sessionStorage.setItem(SESSION_KEY, active ? "1" : "0");

      dlog("sample-rate", rate, "active:", active);

      if (active) start();
    } catch (e) {
      dlog("sample-rate fetch failed", e);
      sessionStorage.setItem(SESSION_KEY, "0");
    }
  }

  boot();
})();
