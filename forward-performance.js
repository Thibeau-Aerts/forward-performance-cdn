(function () {
  const API_ENDPOINT = "https://webhook.sinners.be/receive.php";

  const payload = {
    timestamp: new Date().toISOString(),
    path: location.pathname || "/",
    location: {},
    metrics: {},
    reason: null,
  };

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
    if (!window.webVitals) return;

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    function metricHandler(metric) {
      payload.metrics[metric.name] = {
        value: metric.value,
        rating: metric.rating,
      };
    }

    onCLS(metricHandler);
    onINP(metricHandler);
    onLCP(metricHandler);
    onFCP(metricHandler);
    onTTFB(metricHandler);
  }

  /* =========================
     🌍 LOCATION
  ========================= */
  fetch("https://ipapi.co/json/")
    .then((r) => r.json())
    .then((data) => {
      payload.location = {
        country: data.country_name,
        city: data.city,
        continent: data.continent_code,
        inEU: data.in_eu,
      };
    })
    .catch(() => {});

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
