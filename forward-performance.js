(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    page: {},
    region: {},
    metrics: {},
    userAgent: navigator.userAgent,
  };

  function log(msg, data) {
    console.log(msg, data || "");
  }

  /* =========================
     🌐 PAGE INFO
  ========================= */
  function logPageInfo() {
    session.page = {
      url: location.href,
      path: location.pathname,
      hash: location.hash || null,
      referrer: document.referrer || "direct",
      title: document.title,
    };

    log("🌐 PAGE", session.page);
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

  function initVitals() {
    if (!window.webVitals) {
      log("❌ web-vitals kon niet geladen worden");
      return;
    }

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    function metricHandler(metric) {
      session.metrics[metric.name] = {
        value: metric.value,
        rating: metric.rating,
      };

      const value =
        metric.name === "CLS"
          ? metric.value.toFixed(4)
          : Math.round(metric.value) + "ms";

      log("📊 " + metric.name, value + " (" + metric.rating + ")");
    }

    onCLS(metricHandler);
    onINP(metricHandler);
    onLCP(metricHandler);
    onFCP(metricHandler);
    onTTFB(metricHandler);
  }

  /* =========================
     🌍 REGION
  ========================= */
  async function logRegion() {
    try {
      const res = await fetch("https://ipapi.co/json/");
      const data = await res.json();

      session.region = {
        ip: data.ip,
        country: data.country_name,
        code: data.country_code,
        continent: data.continent_code,
        city: data.city,
        inEU: data.in_eu,
      };

      log("🌍 REGION", session.region);
    } catch {
      log("❌ REGION ophalen mislukt");
    }
  }

  /* =========================
     📡 SEND TO API
  ========================= */
  function sendToApi(reason = "unknown") {
    session.endedAt = new Date().toISOString();
    session.reason = reason;

    const payload = JSON.stringify(session);

    log("📡 Forward → sending payload", session);

    try {
      navigator.sendBeacon(API_ENDPOINT, payload);
    } catch {
      fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }

  /* =========================
     🚀 INIT
  ========================= */
  function init() {
    log("🚀 INIT Forward performance gestart");
    logPageInfo();
    loadWebVitals(initVitals);
    logRegion();

    // 👉 Post wanneer pagina verdwijnt
    window.addEventListener("pagehide", () => sendToApi("pagehide"));

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        sendToApi("visibilitychange");
      }
    });
  }

  window.ForwardPerformance = {
    init,
    sendNow: () => sendToApi("manual"),
    getSession: () => session,
  };
})();
