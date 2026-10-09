/**
 * One session ID for this underwriting run.
 * INPUT  = exposures/{id}   (parsed slip)
 * OUTPUT = model_runs/{id}  (CAT JSON)
 * The browser stores the ID only — not the documents.
 */
(function (global) {
  const KEY = "kenyaReSessionId";

  function fromQuery() {
    try {
      return new URLSearchParams(global.location.search).get("id");
    } catch (_) {
      return null;
    }
  }

  function get() {
    const q = fromQuery();
    if (q) {
      set(q);
      return q;
    }
    try {
      return global.sessionStorage.getItem(KEY);
    } catch (_) {
      return null;
    }
  }

  function set(id) {
    if (id == null || id === "") return null;
    const clean = String(id).trim();
    if (!clean) return null;
    try {
      global.sessionStorage.setItem(KEY, clean);
      global.sessionStorage.removeItem("kenyaReResults");
      global.sessionStorage.removeItem("kenyaReHandoff");
    } catch (_) {}
    return clean;
  }

  function clear() {
    try {
      global.sessionStorage.removeItem(KEY);
      global.sessionStorage.removeItem("kenyaReResults");
      global.sessionStorage.removeItem("kenyaReHandoff");
    } catch (_) {}
  }

  function href(page) {
    const id = get();
    if (!id) return page;
    const join = page.indexOf("?") >= 0 ? "&" : "?";
    return page + join + "id=" + encodeURIComponent(id);
  }

  global.KenyaReSession = { get: get, set: set, clear: clear, href: href };
})(window);
