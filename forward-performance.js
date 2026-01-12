(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  const payload = {
    timestamp: new Date().toISOString(),
    path: location.pathname || "/",
    url: location.href,
    referrer: document.referrer || null,

    continent: null,

    metrics: {},
    lcp: null,
    inp: null,
    cls: null,

    device: {},
    network: {},
    page: {},
    timing: {},

    reason: null,
  };

  /* =========================
     🌍 LOCATION (continent)
  ========================= */
  fetch("https://ipapi.co/json/")
    .then((r) => r.json())
    .then((d) => {
      payload.continent = d.continent_code || null;
    })
    .catch(() => {});

  /* =========================
     📱 DEVICE INFO
  ========================= */
  payload.device = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    memory: navigator.deviceMemory || null,
    cores: navigator.hardwareConcurrency || null,
    mobile: /Mobi|Android|iPhone/i.test(navigator.userAgent),
    userAgent: navigator.userAgent,
  };

  /* =========================
     🌐 NETWORK INFO
  ========================= */
  if (navigator.connection) {
    payload.network = {
      type: navigator.connection.effectiveType,
      downlink: navigator.connection.downlink,
      rtt: navigator.connection.rtt,
      saveData: navigator.connection.saveData,
    };
  }

  /* =========================
     📄 PAGE WEIGHT
  ========================= */
  payload.page = {
    domNodes: document.getElementsByTagName("*").length,
    resources: performance.getEntriesByType("resource").length,
  };

  /* =========================
     ⏱ NAVIGATION TIMING
  ========================= */
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav) {
    payload.timing = {
      dns: nav.domainLookupEnd - nav.domainLookupStart,
      tcp: nav.connectEnd - nav.connectStart,
      tls: nav.secureConnectionStart
        ? nav.connectEnd - nav.secureConnectionStart
        : null,
      ttfb: nav.responseStart - nav.requestStart,
      response: nav.responseEnd - nav.responseStart,
      domInteractive: nav.domInteractive - nav.startTime,
      domComplete: nav.domComplete - nav.startTime,
      load: nav.loadEventEnd - nav.startTime,
    };
  }

  /* =========================
     📊 WEB VITALS
  ========================= */
  function loadWebVitals(cb) {
    if (window.webVitals) return cb();
    const s = document.createElement("script");
    s.src = "https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function cssPath(el) {
    if (!el || !el.tagName) return null;
    let path = [];
    while (el && el.nodeType === 1 && path.length < 4) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += "#" + el.id;
        path.unshift(selector);
        break;
      } else {
        if (el.className) {
          selector += "." + el.className.trim().split(/\s+/).join(".");
        }
        path.unshift(selector);
        el = el.parentElement;
      }
    }
    return path.join(" > ");
  }

  function initVitals() {
    if (!window.webVitals) return;

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    onFCP((m) => (payload.metrics.FCP = Math.round(m.value)));
    onTTFB((m) => (payload.metrics.TTFB = Math.round(m.value)));

    onLCP((m) => {
      payload.metrics.LCP = Math.round(m.value);
      const e = m.entries?.[m.entries.length - 1];
      if (e && e.element) {
        payload.lcp = {
          tag: e.element.tagName,
          src: e.element.currentSrc || e.element.src || null,
          selector: cssPath(e.element),
        };
      }
    });

    onINP((m) => {
      payload.metrics.INP = Math.round(m.value);
      const e = m.entries?.[0];
      if (e && e.target) {
        payload.inp = {
          tag: e.target.tagName,
          text: (e.target.innerText || "").slice(0, 80),
          selector: cssPath(e.target),
          type: e.name,
        };
      }
    });

    let clsSources = [];
    onCLS((m) => {
      payload.metrics.CLS = Number(m.value.toFixed(4));
      m.entries.forEach((e) => {
        e.sources?.forEach((s) => {
          if (s.node) {
            clsSources.push({
              tag: s.node.tagName,
              selector: cssPath(s.node),
            });
          }
        });
      });
      payload.cls = clsSources.slice(0, 5);
    });
  }

  /* =========================
     📡 SEND
  ========================= */
  function send(reason) {
    payload.reason = reason;
    payload.timestamp = new Date().toISOString();
    const body = JSON.stringify(payload);

    try {
      navigator.sendBeacon(API_ENDPOINT, body);
    } catch {
      fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }

  /* =========================
     🚀 AUTO START
  ========================= */
  loadWebVitals(initVitals);

  window.addEventListener("pagehide", () => send("pagehide"));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      send("visibilitychange");
    }
  });
})();
