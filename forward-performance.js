(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  // Zet debug aan door ?fpdebug=1 in je URL
  const DEBUG = new URLSearchParams(location.search).get("fpdebug") === "1";

  function dlog(...args) {
    if (DEBUG) console.log("[ForwardPerformance]", ...args);
  }

  // Een sessie-id per tab
  const SESSION_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    "sess_" + Math.random().toString(16).slice(2);

  let current = null; // huidige route payload
  let currentRouteId = 0;

  // ----------------------------
  // Helpers
  // ----------------------------
  function nowISO() {
    return new Date().toISOString();
  }

  function safeNumber(n) {
    return typeof n === "number" && isFinite(n) ? n : null;
  }

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
      dns: safeNumber(nav.domainLookupEnd - nav.domainLookupStart),
      tcp: safeNumber(nav.connectEnd - nav.connectStart),
      tls: nav.secureConnectionStart
        ? safeNumber(nav.connectEnd - nav.secureConnectionStart)
        : null,
      ttfb: safeNumber(nav.responseStart - nav.requestStart),
      response: safeNumber(nav.responseEnd - nav.responseStart),
      domInteractive: safeNumber(nav.domInteractive - nav.startTime),
      domComplete: safeNumber(nav.domComplete - nav.startTime),
      load: safeNumber(nav.loadEventEnd - nav.startTime),
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

  // ----------------------------
  // Web-vitals loading
  // ----------------------------
  let webVitalsReady = false;
  let webVitalsLoading = false;
  const webVitalsWaiters = [];

  function loadWebVitals(cb) {
    if (window.webVitals) {
      webVitalsReady = true;
      cb();
      return;
    }
    webVitalsWaiters.push(cb);
    if (webVitalsLoading) return;

    webVitalsLoading = true;
    const s = document.createElement("script");
    s.src = "https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js";
    s.onload = () => {
      webVitalsReady = !!window.webVitals;
      webVitalsLoading = false;
      while (webVitalsWaiters.length) {
        try {
          webVitalsWaiters.shift()();
        } catch {}
      }
    };
    document.head.appendChild(s);
  }

  // ----------------------------
  // Location (continent only)
  // ----------------------------
  let continentCache = null;
  let continentPromise = null;

  function fetchContinent() {
    if (continentCache) return Promise.resolve(continentCache);
    if (continentPromise) return continentPromise;

    continentPromise = fetch("https://ipapi.co/json/")
      .then((r) => r.json())
      .then((d) => {
        continentCache = d.continent_code || null;
        return continentCache;
      })
      .catch(() => null);

    return continentPromise;
  }

  // ----------------------------
  // Payload lifecycle
  // ----------------------------
  function newPayload(routeKind) {
    currentRouteId += 1;

    const p = {
      sessionId: SESSION_ID,
      routeId: currentRouteId,
      routeKind: routeKind || "spa",
      startedAt: nowISO(),

      // page
      path: location.pathname || "/",
      url: location.href,
      referrer: document.referrer || null,

      // geo
      continent: continentCache,

      // vitals
      metrics: {},
      lcp: null,
      inp: null,
      cls: null,

      // context
      device: getDeviceInfo(),
      network: getNetworkInfo(),
      page: getPageInfo(),
      timing: getNavTiming(),

      // send
      reason: null,
      endedAt: null,

      // internal
      _sent: false,
      _clsSources: [],
    };

    return p;
  }

  function beaconSend(json) {
    const body = JSON.stringify(json);

    // sendBeacon best-effort (werkt bij unload)
    try {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(API_ENDPOINT, blob);
      if (ok) return true;
    } catch {}

    // fallback
    try {
      fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function finalizeAndSend(reason, extra) {
    if (!current || current._sent) return;

    current.reason = reason;
    current.endedAt = nowISO();

    if (extra && typeof extra === "object") {
      current.extra = extra;
    }

    // CLS sources in één veld steken (max 8)
    if (current._clsSources && current._clsSources.length) {
      current.cls = current._clsSources.slice(0, 8);
    } else if (current.cls == null) {
      current.cls = null;
    }

    current._sent = true;

    dlog("SEND", reason, {
      path: current.path,
      metrics: current.metrics,
      continent: current.continent,
    });

    beaconSend(stripInternal(current));
  }

  function stripInternal(p) {
    const copy = { ...p };
    delete copy._sent;
    delete copy._clsSources;
    return copy;
  }

  // ----------------------------
  // Vitals binding per route
  // ----------------------------
  let unbindCurrentVitals = null;

  function bindVitalsToCurrentPayload() {
    if (!current) return;

    // Unbind vorige listeners (best-effort)
    if (typeof unbindCurrentVitals === "function") {
      try { unbindCurrentVitals(); } catch {}
      unbindCurrentVitals = null;
    }

    if (!window.webVitals) {
      dlog("web-vitals niet beschikbaar");
      return;
    }

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    // CLS: keep sources
    const clsStop = onCLS(
      (m) => {
        if (!current || current._sent) return;
        current.metrics.CLS = Number(m.value.toFixed(4));

        // bronnen verzamelen
        try {
          m.entries?.forEach((e) => {
            e.sources?.forEach((s) => {
              if (s.node) {
                current._clsSources.push({
                  tag: s.node.tagName,
                  selector: cssPath(s.node),
                });
              }
            });
          });
        } catch {}
      },
      { reportAllChanges: true }
    );

    // INP: save worst interaction + target
    const inpStop = onINP(
      (m) => {
        if (!current || current._sent) return;
        current.metrics.INP = Math.round(m.value);

        try {
          const e = m.entries?.[0];
          if (e && e.target) {
            current.inp = {
              tag: e.target.tagName,
              text: (e.target.innerText || "").slice(0, 80) || null,
              selector: cssPath(e.target),
              type: e.name || null,
            };
          }
        } catch {}
      },
      { reportAllChanges: true }
    );

    // LCP: save value + element
    const lcpStop = onLCP(
      (m) => {
        if (!current || current._sent) return;
        current.metrics.LCP = Math.round(m.value);

        try {
          const e = m.entries?.[m.entries.length - 1];
          if (e && e.element) {
            current.lcp = {
              tag: e.element.tagName,
              src: e.element.currentSrc || e.element.src || null,
              selector: cssPath(e.element),
            };
          }
        } catch {}
      },
      { reportAllChanges: true }
    );

    const fcpStop = onFCP((m) => {
      if (!current || current._sent) return;
      current.metrics.FCP = Math.round(m.value);
    });

    const ttfbStop = onTTFB((m) => {
      if (!current || current._sent) return;
      current.metrics.TTFB = Math.round(m.value);
    });

    // Unbind functie (als web-vitals stop callbacks geeft, is dat top; anders noop)
    unbindCurrentVitals = () => {
      // web-vitals v4 geeft doorgaans een "stop" function terug
      try { typeof clsStop === "function" && clsStop(); } catch {}
      try { typeof inpStop === "function" && inpStop(); } catch {}
      try { typeof lcpStop === "function" && lcpStop(); } catch {}
      try { typeof fcpStop === "function" && fcpStop(); } catch {}
      try { typeof ttfbStop === "function" && ttfbStop(); } catch {}
    };

    dlog("Vitals bound to route", current.path);
  }

  // ----------------------------
  // Route tracking (SPA)
  // ----------------------------
  let lastUrl = location.href;

  function onRouteMaybeChanged(trigger) {
    const newUrl = location.href;
    if (newUrl === lastUrl) return;

    const from = lastUrl;
    lastUrl = newUrl;

    // Send vorige route
    finalizeAndSend("route-change", { trigger, from, to: newUrl });

    // Start nieuwe route payload
    current = newPayload("spa");
    // update continent async
    fetchContinent().then((c) => (current.continent = c)).catch(() => {});

    // (Re)bind vitals voor deze route
    loadWebVitals(() => {
      bindVitalsToCurrentPayload();
    });

    dlog("Route changed", { trigger, from, to: newUrl });
  }

  function hookHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function () {
      origPush.apply(this, arguments);
      window.dispatchEvent(new Event("forward:route"));
    };

    history.replaceState = function () {
      origReplace.apply(this, arguments);
      window.dispatchEvent(new Event("forward:route"));
    };

    window.addEventListener("popstate", () => onRouteMaybeChanged("popstate"));
    window.addEventListener("hashchange", () => onRouteMaybeChanged("hashchange"));
    window.addEventListener("forward:route", () => onRouteMaybeChanged("history"));
  }

  // ----------------------------
  // Start
  // ----------------------------
  function start() {
    // init first payload
    current = newPayload("load");

    // continent async
    fetchContinent().then((c) => (current.continent = c)).catch(() => {});

    // bind vitals
    loadWebVitals(() => {
      bindVitalsToCurrentPayload();
    });

    // SPA routing hooks
    hookHistory();

    // Send on exit
    window.addEventListener("pagehide", () => finalizeAndSend("pagehide"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") finalizeAndSend("visibilitychange");
    });

    dlog("Started", { sessionId: SESSION_ID, path: current.path });
  }

  start();
})();
