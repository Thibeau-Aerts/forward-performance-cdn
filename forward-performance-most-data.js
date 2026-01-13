(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  /* =========================================================
     DEBUG MODE
     Zet ?fpdebug=1 in je URL om console logs te zien
  ========================================================= */
  const DEBUG = new URLSearchParams(location.search).get("fpdebug") === "1";
  const dlog = (...a) => DEBUG && console.log("[ForwardPerformance]", ...a);

  /* =========================================================
     SESSIE IDENTITEIT (per tab)
  ========================================================= */
  const SESSION_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    "sess_" + Math.random().toString(16).slice(2);

  let current = null;            // huidig payload object
  let currentRouteId = 0;        // oplopend per route
  let lastUrl = location.href;   // SPA referrer

  // caches om null te vermijden
  let lastLCPElement = null;
  let lastInteraction = null;

  /* =========================================================
     HELPERS
  ========================================================= */

  const nowISO = () => new Date().toISOString();
  const safe = (n) => (typeof n === "number" && isFinite(n) ? n : null);

  // Bouwt een korte maar bruikbare CSS selector
  function cssPath(el) {
    try {
      if (!el || !el.tagName) return null;
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 5) {
        let s = node.tagName.toLowerCase();
        if (node.id) {
          s += "#" + node.id;
          parts.unshift(s);
          break;
        }
        if (node.className && typeof node.className === "string") {
          const cls = node.className.trim().split(/\s+/).slice(0, 3).join(".");
          if (cls) s += "." + cls;
        }
        parts.unshift(s);
        node = node.parentElement;
      }
      return parts.join(" > ");
    } catch {
      return null;
    }
  }

  function getNavTiming() {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return {};
    return {
      dns: safe(nav.domainLookupEnd - nav.domainLookupStart),
      tcp: safe(nav.connectEnd - nav.connectStart),
      tls: nav.secureConnectionStart
        ? safe(nav.connectEnd - nav.secureConnectionStart)
        : null,
      ttfb: safe(nav.responseStart - nav.requestStart),
      response: safe(nav.responseEnd - nav.responseStart),
      domInteractive: safe(nav.domInteractive - nav.startTime),
      domComplete: safe(nav.domComplete - nav.startTime),
      load: safe(nav.loadEventEnd - nav.startTime),
    };
  }

  function getDeviceInfo() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
      memory: navigator.deviceMemory || null,
      cores: navigator.hardwareConcurrency || null,
      mobile: /Mobi|Android|iPhone/i.test(navigator.userAgent),
      userAgent: navigator.userAgent,
    };
  }

  function getNetworkInfo() {
    const c = navigator.connection;
    if (!c) return {};
    return {
      type: c.effectiveType,
      downlink: c.downlink,
      rtt: c.rtt,
      saveData: c.saveData,
    };
  }

  function getPageInfo() {
    return {
      domNodes: document.getElementsByTagName("*").length,
      resources: performance.getEntriesByType("resource").length,
    };
  }

  /* =========================================================
     INTERACTION FALLBACK (voor INP details)
     → vangt altijd laatste klik / key / pointer target
  ========================================================= */

  ["pointerdown", "click", "keydown"].forEach((type) => {
    addEventListener(
      type,
      (e) => {
        if (e.target && e.target.tagName) {
          lastInteraction = {
            tag: e.target.tagName,
            text: (e.target.innerText || "").slice(0, 80),
            selector: cssPath(e.target),
            type,
            ts: Date.now(),
          };
        }
      },
      { capture: true, passive: true }
    );
  });

  /* =========================================================
     WEB VITALS LOADER
  ========================================================= */

  function loadWebVitals(cb) {
    if (window.webVitals) return cb();
    const s = document.createElement("script");
    s.src = "https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  let unbind = null;

  function bindVitals() {
    if (!current || !window.webVitals) return;
    if (unbind) try { unbind(); } catch {}

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    /* ---------- CLS ---------- */
    const clsStop = onCLS((m) => {
      if (!current || current._sent) return;
      current.metrics.CLS = Number(m.value.toFixed(4));

      try {
        m.entries?.forEach((e) =>
          e.sources?.forEach((s) => {
            if (s.node)
              current._clsSources.push({
                tag: s.node.tagName,
                selector: cssPath(s.node),
              });
          })
        );
      } catch {}
    }, { reportAllChanges: true });

    /* ---------- INP ---------- */
    const inpStop = onINP((m) => {
      if (!current || current._sent) return;
      current.metrics.INP = Math.round(m.value);

      try {
        const e = m.entries?.[0];
        if (e?.target) {
          current.inp = {
            tag: e.target.tagName,
            text: (e.target.innerText || "").slice(0, 80),
            selector: cssPath(e.target),
            type: e.name || null,
          };
        } else if (!current.inp && lastInteraction) {
          current.inp = lastInteraction;
        }
      } catch {}
    }, { reportAllChanges: true });

    /* ---------- LCP ---------- */
    const lcpStop = onLCP((m) => {
      if (!current || current._sent) return;
      current.metrics.LCP = Math.round(m.value);

      try {
        const e = m.entries?.[m.entries.length - 1];
        if (e?.element) {
          lastLCPElement = {
            tag: e.element.tagName,
            src: e.element.currentSrc || e.element.src || null,
            selector: cssPath(e.element),
          };
          current.lcp = lastLCPElement;
        } else if (!current.lcp && lastLCPElement) {
          current.lcp = lastLCPElement;
        }
      } catch {}
    }, { reportAllChanges: true });

    /* ---------- FCP ---------- */
    const fcpStop = onFCP((m) => {
      if (!current || current._sent) return;
      current.metrics.FCP = Math.round(m.value);
    });

    /* ---------- TTFB ---------- */
    const ttfbStop = onTTFB((m) => {
      if (!current || current._sent) return;
      current.metrics.TTFB = Math.round(m.value);
    });

    unbind = () => {
      try { clsStop && clsStop(); } catch {}
      try { inpStop && inpStop(); } catch {}
      try { lcpStop && lcpStop(); } catch {}
      try { fcpStop && fcpStop(); } catch {}
      try { ttfbStop && ttfbStop(); } catch {}
    };
  }

  /* =========================================================
     PAYLOAD OBJECT
  ========================================================= */

  function newPayload(kind) {
    currentRouteId++;
    return {
      sessionId: SESSION_ID,
      routeId: currentRouteId,
      routeKind: kind,
      startedAt: nowISO(),

      path: location.pathname || "/",
      url: location.href,
      referrer: lastUrl || null,

      metrics: {},
      lcp: null,
      inp: null,
      cls: [],

      device: getDeviceInfo(),
      network: getNetworkInfo(),
      page: getPageInfo(),
      timing: getNavTiming(),

      reason: null,
      endedAt: null,

      _sent: false,
      _clsSources: [],
    };
  }

  /* =========================================================
     SEND NAAR BACKEND
  ========================================================= */

  function send(reason, extra) {
    if (!current || current._sent) return;

    current.reason = reason;
    current.endedAt = nowISO();

    current.cls = current._clsSources.length
      ? current._clsSources.slice(0, 8)
      : [];

    if (!current.lcp && lastLCPElement) current.lcp = lastLCPElement;
    if (!current.inp && lastInteraction) current.inp = lastInteraction;

    if (extra) current.extra = extra;
    current._sent = true;

    const clean = { ...current };
    delete clean._sent;
    delete clean._clsSources;

    try {
      navigator.sendBeacon(API_ENDPOINT, JSON.stringify(clean));
    } catch {
      fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
        keepalive: true,
      }).catch(() => {});
    }

    dlog("sent", reason, clean.path);
  }

  /* =========================================================
     SPA ROUTE TRACKING
  ========================================================= */

  function onRouteChange(trigger) {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;

    const from = lastUrl;
    lastUrl = newUrl;

    send("route-change", { trigger, from, to: newUrl });

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
      if (document.visibilityState === "hidden") send("visibilitychange");
    });

    dlog("started", current.path);
  }

  start();
})();
