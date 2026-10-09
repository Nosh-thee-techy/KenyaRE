(function (global) {
  const BOUNDS = window.NAIROBI_RASTER;
  let map;
  let marker;
  let rasterRect;
  let pendingLat = null;
  let pendingLon = null;
  let pendingSource = "human";
  let mapReady = false;
  let queued = null;

  function box() {
    return {
      latMin: BOUNDS.latMin,
      latMax: BOUNDS.latMax,
      lonMin: BOUNDS.lonMin,
      lonMax: BOUNDS.lonMax != null ? BOUNDS.lonMax : 37.05,
    };
  }

  function updateOkay() {
    const ok = document.getElementById("map-ok");
    const hint = document.getElementById("map-pin-hint");
    if (ok) ok.disabled = pendingLat == null || pendingLon == null;
    if (hint) {
      if (pendingLat == null || pendingLon == null) {
        hint.textContent = "Click the map to place a pin, then press Okay to save.";
      } else {
        hint.textContent =
          "Pin at " +
          pendingLat.toFixed(4) +
          ", " +
          pendingLon.toFixed(4) +
          ". Press Okay to save.";
      }
    }
  }

  function stagePin(lat, lon, source) {
    const a = Number(lat);
    const b = Number(lon);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      pendingLat = null;
      pendingLon = null;
      updateOkay();
      return;
    }
    pendingLat = a;
    pendingLon = b;
    if (source) pendingSource = source;
    updateOkay();
  }

  function confirmPin() {
    if (pendingLat == null || pendingLon == null) return;
    if (global.IntakeApp) {
      global.IntakeApp.applyPin(pendingLat, pendingLon, pendingSource);
    }
    closeModal();
  }

  function rasterBounds() {
    const b = box();
    return L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax]);
  }

  function insideRaster(lat, lon) {
    const b = box();
    lat = Number(lat);
    lon = Number(lon);
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= b.latMin &&
      lat <= b.latMax &&
      lon >= b.lonMin &&
      lon <= b.lonMax
    );
  }

  function setMarker(lat, lon) {
    lat = Number(lat);
    lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!map) {
      queued = { lat: lat, lon: lon, source: pendingSource };
      return;
    }
    const pos = [lat, lon];
    if (!marker) {
      marker = L.marker(pos, { draggable: true }).addTo(map);
      marker.on("dragend", function () {
        const p = marker.getLatLng();
        stagePin(p.lat, p.lng, "human");
      });
    } else {
      marker.setLatLng(pos);
    }
    if (mapReady) {
      map.setView(pos, Math.max(map.getZoom() || 12, 15));
    }
  }

  function flushQueued() {
    if (!queued) return;
    const q = queued;
    queued = null;
    setMarker(q.lat, q.lon);
    stagePin(q.lat, q.lon, q.source);
  }

  function ensureMap(cb) {
    const el = document.getElementById("map");
    if (!el) return;
    if (!map) {
      map = L.map("map", { zoomControl: true }).setView(BOUNDS.center, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      rasterRect = L.rectangle(rasterBounds(), {
        color: "#00274c",
        weight: 1.5,
        fillOpacity: 0.06,
      }).addTo(map);
      rasterRect.bindTooltip("Nairobi hazard raster", { sticky: true });
      map.on("click", function (e) {
        setMarker(e.latlng.lat, e.latlng.lng);
        stagePin(e.latlng.lat, e.latlng.lng, "human");
      });
    }
    function ready() {
      map.invalidateSize();
      mapReady = true;
      flushQueued();
      if (cb) cb();
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ready();
        setTimeout(function () {
          if (map) map.invalidateSize();
        }, 80);
      });
    });
  }

  function pickOpeningPin() {
    const app = global.IntakeApp;
    if (app && typeof app.getLat === "function" && typeof app.getLon === "function") {
      const lat = app.getLat();
      const lon = app.getLon();
      if (lat != null && lon != null) {
        return { lat: lat, lon: lon, source: "human" };
      }
    }
    const sug =
      app && typeof app.getGeocodeSuggestion === "function"
        ? app.getGeocodeSuggestion()
        : null;
    if (sug && sug.lat != null && sug.lon != null) {
      return {
        lat: Number(sug.lat),
        lon: Number(sug.lon),
        source: "geocoded",
      };
    }
    return null;
  }

  function preview(lat, lon, source) {
    stagePin(lat, lon, source || "human");
    if (map) {
      setMarker(lat, lon);
      if (mapReady) map.invalidateSize();
    } else {
      queued = {
        lat: Number(lat),
        lon: Number(lon),
        source: source || "human",
      };
    }
  }

  function openModal() {
    const el = document.getElementById("map-modal");
    if (!el) return;
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
    const qEl = document.getElementById("geocode-q");
    const sug =
      global.IntakeApp && typeof global.IntakeApp.getGeocodeSuggestion === "function"
        ? global.IntakeApp.getGeocodeSuggestion()
        : null;
    if (qEl && sug && sug.query && !qEl.value) qEl.value = sug.query;
    ensureMap(function () {
      const pin = pickOpeningPin();
      if (pin) {
        setMarker(pin.lat, pin.lon);
        stagePin(pin.lat, pin.lon, pin.source);
      } else {
        pendingLat = null;
        pendingLon = null;
        pendingSource = "human";
        updateOkay();
        map.fitBounds(rasterBounds(), { padding: [24, 24] });
      }
    });
    const boxEl = document.getElementById("geocode-results");
    if (boxEl) boxEl.innerHTML = "";
    if (qEl) qEl.focus();
  }

  function closeModal() {
    const el = document.getElementById("map-modal");
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  async function geocode(query) {
    const b = box();
    const viewbox = [b.lonMin, b.latMin, b.lonMax, b.latMax].join(",");
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ke&viewbox=" +
      encodeURIComponent(viewbox) +
      "&bounded=0&q=" +
      encodeURIComponent(query);

    try {
      const api = await fetch(
        (window.KENYARE_API || "") + "/api/intake/geocode?q=" + encodeURIComponent(query)
      );
      if (api.ok) {
        const rows = await api.json();
        if (Array.isArray(rows)) return rows;
      }
    } catch (_) {
      /* fall through to Nominatim */
    }

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Geocode failed");
    const rows = await res.json();
    return rows.map(function (r) {
      return {
        label: r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
      };
    });
  }

  async function searchAddress() {
    const q = document.getElementById("geocode-q").value.trim();
    const results = document.getElementById("geocode-results");
    if (!q) return;
    results.textContent = "Searching…";
    try {
      const hits = await geocode(q);
      if (!hits.length) {
        results.innerHTML =
          '<p class="text-xs text-[var(--muted)] px-3 py-2">No hits. Drop a pin on the map instead.</p>';
        return;
      }
      results.innerHTML = hits
        .map(function (h, i) {
          return (
            '<button type="button" data-hit="' +
            i +
            '" class="block w-full text-left text-xs px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--bg)]">' +
            h.label +
            "</button>"
          );
        })
        .join("");
      results.querySelectorAll("[data-hit]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          const h = hits[Number(btn.getAttribute("data-hit"))];
          ensureMap(function () {
            setMarker(h.lat, h.lon);
            stagePin(h.lat, h.lon, "geocoded");
            map.setView([h.lat, h.lon], 16);
          });
        });
      });
    } catch (err) {
      results.innerHTML =
        '<p class="text-xs text-[var(--red)] px-3 py-2">Search failed. Drop a pin instead.</p>';
    }
  }

  global.MapModal = {
    open: openModal,
    close: closeModal,
    confirm: confirmPin,
    insideRaster: insideRaster,
    searchAddress: searchAddress,
    preview: preview,
    showSuggestion: function (sug) {
      if (!sug || sug.lat == null || sug.lon == null) return;
      preview(sug.lat, sug.lon, "geocoded");
    },
  };

  const okBtn = document.getElementById("map-ok");
  if (okBtn) okBtn.addEventListener("click", confirmPin);
  const cancelBtn = document.getElementById("map-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
})(window);
