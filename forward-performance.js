(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  // Debug via ?fpdebug=1
  const DEBUG = new URLSearchParams(location.search).get("fpdebug") === "1";
  const dlog = (...a) => DEBUG && console.log("[ForwardPerformance]", ...a);

  const SESSION_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    "sess_" + Math.random().toString(16).slice(2);

  let current = null;
  let currentRouteId = 0;
  let lastUrl = location.href;

  /* -------------------- helpers -------------------- */

  const nowISO = () => new Date().toISOString();
  const safe = (n) => (typeof n === "number" && isFinite(n) ? n : null);

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

  /* -------------------- web vitals -------------------- */

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
        }
      } catch {}
    }, { reportAllChanges: true });

    const lcpStop = onLCP((m) => {
      if (!current || current._sent) return;
      current.metrics.LCP = Math.round(m.value);
      try {
        const e = m.entries?.[m.entries.length - 1];
        if (e?.element) {
          current.lcp = {
            tag: e.element.tagName,
            src: e.element.currentSrc || e.element.src || null,
            selector: cssPath(e.element),
          };
        }
      } catch {}
    }, { reportAllChanges: true });

    const fcpStop = onFCP((m) => {
      if (!current || current._sent) return;
      current.metrics.FCP = Math.round(m.value);
    });

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

  /* -------------------- payload -------------------- */

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
      cls: null,
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

  function send(reason, extra) {
    if (!current || current._sent) return;
    current.reason = reason;
    current.endedAt = nowISO();
    if (current._clsSources.length) current.cls = current._clsSources.slice(0, 8);
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

  /* -------------------- routing -------------------- */

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

  /* -------------------- start -------------------- */

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
