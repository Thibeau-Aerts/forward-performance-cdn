(function () {
  const STORAGE_KEY = "forward_performance_log";

  function now() {
    return new Date().toISOString();
  }

  function saveLine(line) {
    try {
      const existing = localStorage.getItem(STORAGE_KEY) || "";
      localStorage.setItem(STORAGE_KEY, existing + line + "\n");
    } catch (e) {
      console.warn("ForwardPerformance: localStorage niet beschikbaar");
    }
  }

  function log(line) {
    console.log(line);
    saveLine("[" + now() + "] " + line);
  }

  function loadWebVitals(callback) {
    if (window.webVitals) {
      callback();
      return;
    }

    const s = document.createElement("script");
    s.src = "https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js";
    s.onload = callback;
    document.head.appendChild(s);
  }

  function initVitals() {
    if (!window.webVitals) {
      log("❌ web-vitals kon niet geladen worden");
      return;
    }

    const { onCLS, onINP, onLCP, onFCP, onTTFB } = window.webVitals;

    function metricHandler(metric) {
      const value =
        metric.name === "CLS"
          ? metric.value.toFixed(4)
          : Math.round(metric.value) + "ms";

      log("📊 " + metric.name + ": " + value + " (" + metric.rating + ")");
    }

    onCLS(metricHandler);
    onINP(metricHandler);
    onLCP(metricHandler);
    onFCP(metricHandler);
    onTTFB(metricHandler);
  }

  async function logRegion() {
    try {
      const res = await fetch("https://ipapi.co/json/");
      const data = await res.json();

      log(
        "🌍 REGION: " +
          data.country_name +
          " (" +
          data.continent_code +
          ") - " +
          data.city +
          " | EU: " +
          data.in_eu
      );
    } catch (e) {
      log("❌ REGION: ophalen mislukt");
    }
  }

  function init() {
    log("🚀 INIT Forward performance gestart");
    loadWebVitals(initVitals);
    logRegion();
  }

  window.ForwardPerformance = {
    init: init,
    getLogs: function () {
      return localStorage.getItem(STORAGE_KEY);
    },
    clearLogs: function () {
      localStorage.removeItem(STORAGE_KEY);
    },
  };
})();
