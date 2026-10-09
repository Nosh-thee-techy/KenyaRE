/**
 * One session ID for this underwriting run.
 * INPUT  = exposures/{id}   (parsed slip)
 * OUTPUT = model_runs/{id}  (CAT JSON)
 * The browser stores the ID only — not the documents.
 * Pending / fresh-run keys keep Analysis from flashing an empty desk.
 */
(function (global) {
  const KEY = "kenyaReSessionId";
  const PENDING_KEY = "kenyaReRunPending";
  const FRESH_KEY = "kenyaReFreshRun";
  const AGG_STEPS = ["hazard", "vulnerability", "exposure", "finance", "results"];

  function fromQuery() {
    try {
      return new URLSearchParams(global.location.search).get("id");
    } catch (_) {
      return null;
    }
  }

  function storeGet(k) {
    try {
      return global.sessionStorage.getItem(k);
    } catch (_) {
      return null;
    }
  }

  function storeSet(k, v) {
    try {
      if (v == null) global.sessionStorage.removeItem(k);
      else global.sessionStorage.setItem(k, v);
    } catch (_) {}
  }

  function get() {
    const q = fromQuery();
    if (q) {
      set(q);
      return q;
    }
    return storeGet(KEY);
  }

  function set(id) {
    if (id == null || id === "") return null;
    const clean = String(id).trim();
    if (!clean) return null;
    storeSet(KEY, clean);
    storeSet("kenyaReResults", null);
    storeSet("kenyaReHandoff", null);
    return clean;
  }

  function clear() {
    storeSet(KEY, null);
    storeSet("kenyaReResults", null);
    storeSet("kenyaReHandoff", null);
    storeSet(PENDING_KEY, null);
    storeSet(FRESH_KEY, null);
  }

  function href(page) {
    const id = get();
    if (!id) return page;
    const join = page.indexOf("?") >= 0 ? "&" : "?";
    return page + join + "id=" + encodeURIComponent(id);
  }

  function stampNav() {
    const id = get();
    if (!id) return;
    document.querySelectorAll("a[href='review.html'], a[href='analysis.html']").forEach(function (a) {
      a.setAttribute("href", href(a.getAttribute("href")));
    });
  }

  function setPending(id) {
    storeSet(PENDING_KEY, id ? String(id) : null);
    return id || null;
  }

  function getPending() {
    return storeGet(PENDING_KEY);
  }

  function clearPending() {
    storeSet(PENDING_KEY, null);
  }

  function setFreshRun(bundle) {
    if (!bundle || !bundle.id) {
      storeSet(FRESH_KEY, null);
      return null;
    }
    try {
      storeSet(FRESH_KEY, JSON.stringify(bundle));
    } catch (_) {
      storeSet(FRESH_KEY, null);
    }
    return bundle.id;
  }

  function getFreshRun(id) {
    const raw = storeGet(FRESH_KEY);
    if (!raw) return null;
    try {
      const bundle = JSON.parse(raw);
      if (!bundle || !bundle.id) return null;
      if (id && String(bundle.id) !== String(id)) return null;
      return bundle;
    } catch (_) {
      return null;
    }
  }

  function clearFreshRun() {
    storeSet(FRESH_KEY, null);
  }

  let aggTimer = null;
  let aggIndex = 0;

  function aggRoot() {
    return document.getElementById("run-agg");
  }

  function paintAggStep(index) {
    const root = aggRoot();
    if (!root) return;
    root.querySelectorAll("[data-agg]").forEach(function (el) {
      const order = AGG_STEPS.indexOf(el.getAttribute("data-agg"));
      el.classList.toggle("is-done", order < index);
      el.classList.toggle("is-on", order === index);
    });
  }

  function showAgg(meta) {
    const root = aggRoot();
    if (!root) return;
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("run-agg-open");
    const pin = document.getElementById("run-agg-pin");
    if (pin) {
      const name = meta && meta.property ? String(meta.property) : "This risk";
      const lat = meta && meta.lat != null ? Number(meta.lat).toFixed(4) : null;
      const lon = meta && meta.lon != null ? Number(meta.lon).toFixed(4) : null;
      pin.textContent =
        lat != null && lon != null ? name + " · " + lat + ", " + lon : name;
    }
    aggIndex = 0;
    paintAggStep(0);
    if (aggTimer) clearInterval(aggTimer);
    aggTimer = setInterval(function () {
      if (aggIndex < AGG_STEPS.length - 1) aggIndex += 1;
      paintAggStep(aggIndex);
    }, 1400);
  }

  function hideAgg() {
    if (aggTimer) {
      clearInterval(aggTimer);
      aggTimer = null;
    }
    const root = aggRoot();
    if (!root) return;
    paintAggStep(AGG_STEPS.length);
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("run-agg-open");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", stampNav);
  } else {
    stampNav();
  }

  global.KenyaReSession = {
    get: get,
    set: set,
    clear: clear,
    href: href,
    setPending: setPending,
    getPending: getPending,
    clearPending: clearPending,
    setFreshRun: setFreshRun,
    getFreshRun: getFreshRun,
    clearFreshRun: clearFreshRun,
    showAgg: showAgg,
    hideAgg: hideAgg
  };
})(window);
