(function (global) {
  const BOUNDS = window.NAIROBI_RASTER;
  let map;
  let marker;
  let rasterRect;

  function rasterBounds() {
    return L.latLngBounds(
      [BOUNDS.latMin, BOUNDS.lonMin],
      [BOUNDS.latMax, BOUNDS.lonMax]
    );
  }

  function insideRaster(lat, lon) {
    return (
      lat >= BOUNDS.latMin &&
      lat <= BOUNDS.latMax &&
      lon >= BOUNDS.lonMin &&
      lon <= BOUNDS.lonMax
    );
  }

  function setMarker(lat, lon) {
    const pos = [lat, lon];
    if (!marker) {
      marker = L.marker(pos, { draggable: true }).addTo(map);
      marker.on("dragend", function () {
        const p = marker.getLatLng();
        if (global.IntakeApp) {
          global.IntakeApp.applyPin(p.lat, p.lng);
        }
      });
    } else {
      marker.setLatLng(pos);
    }
    map.setView(pos, 15);
  }

  function openModal() {
    const el = document.getElementById("map-modal");
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
    requestAnimationFrame(function () {
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
          if (global.IntakeApp) {
            global.IntakeApp.applyPin(e.latlng.lat, e.latlng.lng);
          }
        });
      }
      map.invalidateSize();
      const lat = global.IntakeApp && global.IntakeApp.getLat();
      const lon = global.IntakeApp && global.IntakeApp.getLon();
      if (lat != null && lon != null) {
        setMarker(lat, lon);
      } else {
        map.fitBounds(rasterBounds(), { padding: [24, 24] });
      }
    });
    document.getElementById("geocode-results").innerHTML = "";
    document.getElementById("geocode-q").focus();
  }

  function closeModal() {
    const el = document.getElementById("map-modal");
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  async function geocode(query) {
    const box = [
      BOUNDS.lonMin,
      BOUNDS.latMin,
      BOUNDS.lonMax,
      BOUNDS.latMax,
    ].join(",");
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ke&viewbox=" +
      encodeURIComponent(box) +
      "&bounded=0&q=" +
      encodeURIComponent(query);

    try {
      const api = await fetch("/api/intake/geocode?q=" + encodeURIComponent(query));
      if (api.ok) {
        return api.json();
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
    const box = document.getElementById("geocode-results");
    if (!q) return;
    box.textContent = "Searching…";
    try {
      const hits = await geocode(q);
      if (!hits.length) {
        box.innerHTML =
          '<p class="text-xs text-[var(--muted)] px-3 py-2">No hits. Drop a pin on the map instead.</p>';
        return;
      }
      box.innerHTML = hits
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
      box.querySelectorAll("[data-hit]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          const h = hits[Number(btn.getAttribute("data-hit"))];
          setMarker(h.lat, h.lon);
          if (global.IntakeApp) {
            global.IntakeApp.applyPin(h.lat, h.lon, "geocoded");
          }
        });
      });
    } catch (err) {
      box.innerHTML =
        '<p class="text-xs text-[var(--red)] px-3 py-2">Search failed. Drop a pin instead.</p>';
    }
  }

  global.MapModal = {
    open: openModal,
    close: closeModal,
    insideRaster: insideRaster,
    searchAddress: searchAddress,
  };
})(window);
