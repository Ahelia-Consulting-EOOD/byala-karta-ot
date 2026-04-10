import maplibregl from "maplibre-gl";

// HTML escape to prevent XSS from GeoJSON properties
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// MapLibre serializes JSON null as the string "null" in feature properties.
// Use this instead of a plain truthy check for nullable stop fields.
function prop(v: unknown): string | null {
  if (v === null || v === undefined || v === "null" || v === "") return null;
  return String(v);
}

// Types
interface Settlement {
  ekatte: string;
  name: string;
  name_en: string;
  type: string;
  oblast: string;
  oblast_code: string;
  obshtina: string;
  nuts2: string;
  population: number;
  has_pt_access: boolean;
  stop_count: number;
}

interface CoverageRow {
  code: string;
  name: string;
  total: number;
  with_pt: number;
  without_pt: number;
  pop_total: number;
  pop_with_pt: number;
  pop_without_pt: number;
  pct_settlements: number;
  pct_population: number;
}

interface Metadata {
  generated_at: string;
  summary: {
    total_settlements: number;
    with_pt_access: number;
    without_pt_access: number;
    pct_settlements_with_pt: number;
    population_total: number;
    population_with_pt: number;
    population_without_pt: number;
    pct_population_with_pt: number;
  };
}

// Globals
let map: maplibregl.Map;
let settlementsData: GeoJSON.FeatureCollection;
let stopsLoadPromise: Promise<void> | null = null;
let nuts2Data: CoverageRow[] = [];
let oblastData: CoverageRow[] = [];
let metadata: Metadata;
let allSettlements: Settlement[] = [];
let coordIndex: Map<string, [number, number]> = new Map();
let boundariesLoaded = false;
let muniLatinNames: Map<string, string> = new Map(); // bg obshtina name -> Latin shapeName

// Latin -> Bulgarian oblast name mapping (geoBoundaries shapeName -> our oblast field)
const OBLAST_NAME_MAP: Record<string, string> = {
  "Blagoevgrad": "Благоевград", "Burgas": "Бургас", "Varna": "Варна",
  "Veliko Tarnovo": "Велико Търново", "Vidin": "Видин", "Vratsa": "Враца",
  "Gabrovo": "Габрово", "Dobrich": "Добрич", "Kardzhali": "Кърджали",
  "Kyustendil": "Кюстендил", "Lovech": "Ловеч", "Montana": "Монтана",
  "Pazardzhik": "Пазарджик", "Pernik": "Перник", "Pleven": "Плевен",
  "Plovdiv": "Пловдив", "Razgrad": "Разград", "Ruse": "Русе",
  "Silistra": "Силистра", "Sliven": "Сливен", "Smolyan": "Смолян",
  "Sofia": "София", "Sofia City": "София (столица)",
  "Stara Zagora": "Стара Загора", "Targovishte": "Търговище",
  "Haskovo": "Хасково", "Shumen": "Шумен", "Yambol": "Ямбол",
};
const BG_TO_LATIN_OBLAST = Object.fromEntries(Object.entries(OBLAST_NAME_MAP).map(([k, v]) => [v, k]));

// Hardcoded municipality name overrides for geoBoundaries mismatches (typos, naming differences)
const MUNI_NAME_OVERRIDES: Record<string, string> = {
  "Георги Дамяново": "Georgi Bamyanovo",  // geoBoundaries typo: B vs D
  "Добрич-селска": "Dobrichka",            // different name form
  "Долна Митрополия": "Dolna Mitropoliya",
  "Марица": "Maritsa",
  "Мизия": "Miziya",
  "Провадия": "Provadiya",
  "Ружинци": "Ruzhinsi",                   // geoBoundaries typo: s vs ts
  "Столична": "Stolichna",
  "Струмяни": "Strumyarni",                // geoBoundaries typo: extra r
  // Сърница: not in geoBoundaries at all
};

// Format numbers with space separator
function fmt(n: number): string {
  return n.toLocaleString("bg-BG");
}

// Show loading
function showLoading() {
  const el = document.createElement("div");
  el.className = "loading-overlay";
  el.id = "loading";
  el.innerHTML = '<div class="spinner"></div><div>Зареждане на данни...</div>';
  document.body.appendChild(el);
}

function hideLoading() {
  document.getElementById("loading")?.remove();
}

// Fetch JSON helper
async function fetchJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.json();
}

// Initialize map
function initMap(): maplibregl.Map {
  return new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      name: "BDP Dataviz",
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        osm: {
          type: "raster",
          tiles: [
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      },
      layers: [
        {
          id: "osm-base",
          type: "raster",
          source: "osm",
          paint: { "raster-saturation": -0.6, "raster-brightness-max": 0.95 },
        },
      ],
    },
    center: [25.5, 42.7],
    zoom: 5,
    minZoom: 4,
    maxZoom: 16,
  });
}

// Fit map to show all of Bulgaria, accounting for sidebar width
function fitToBulgaria() {
  map.fitBounds([[22.35, 41.23], [28.61, 44.22]], {
    padding: { top: 30, bottom: 30, left: 20, right: 20 },
    duration: 1000,
  });
}

// Reset button control
class ResetControl {
  _container?: HTMLDivElement;
  onAdd() {
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Покажи цяла България";
    btn.setAttribute("aria-label", "Покажи цяла България");
    btn.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" style="padding:2px"><path d="M3 3h6V1H1v8h2V3zm14 0h-6V1h8v8h-2V3zM3 17h6v2H1v-8h2v6zm14 0h-6v2h8v-8h-2v6z" fill="currentColor"/></svg>';
    btn.addEventListener("click", () => {
      // Reset all filters
      (document.getElementById("filter-oblast") as HTMLSelectElement).value = "";
      (document.getElementById("filter-municipality") as HTMLSelectElement).value = "";
      (document.querySelector('input[name="pt-status"][value="all"]') as HTMLInputElement).checked = true;
      (document.querySelector('input[name="type-filter"][value="all"]') as HTMLInputElement).checked = true;
      applyFilters();
      highlightOblast(null);
      highlightMunicipality(null);
      fitToBulgaria();
    });
    this._container.appendChild(btn);
    return this._container;
  }
  onRemove() { this._container?.remove(); }
}

// Add settlement layer
function addSettlementLayer() {
  map.addSource("settlements", { type: "geojson", data: settlementsData });

  // Layer 2: Settlement markers
  map.addLayer({
    id: "settlements-circle",
    type: "circle",
    source: "settlements",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 10, 5, 14, 8],
      "circle-color": [
        "case",
        ["get", "has_pt_access"],
        "#16a34a",
        "#dc2626",
      ],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
      "circle-opacity": 0.85,
    },
  });

  // Layer 3: Proportional circles (hidden by default)
  map.addLayer({
    id: "settlements-proportional",
    type: "circle",
    source: "settlements",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": [
        "interpolate", ["linear"],
        ["sqrt", ["max", ["get", "population"], 1]],
        0, 2, 10, 4, 50, 8, 100, 12, 160, 18, 400, 30,
      ],
      "circle-color": [
        "case", ["get", "has_pt_access"], "rgba(22,163,74,0.3)", "rgba(220,38,38,0.3)",
      ],
      "circle-stroke-width": 1,
      "circle-stroke-color": [
        "case", ["get", "has_pt_access"], "#16a34a", "#dc2626",
      ],
    },
  });

  // Settlement popup
  map.on("click", "settlements-circle", (e) => {
    const f = e.features?.[0];
    if (!f || !f.geometry || f.geometry.type !== "Point") return;
    const p = f.properties as Record<string, unknown>;
    const hasPt = p.has_pt_access === true || p.has_pt_access === "true";
    const badgeClass = hasPt ? "has-pt" : "no-pt";
    const badgeText = hasPt ? `${p.stop_count} спирки` : "Без ОТ";

    new maplibregl.Popup({ maxWidth: "280px" })
      .setLngLat(f.geometry.coordinates as [number, number])
      .setHTML(`
        <div class="popup-title">${esc(p.name)}</div>
        <div class="popup-ekatte">ЕКАТТЕ: ${esc(p.ekatte)} | ${p.type === "гр." ? "Град" : "Село"}</div>
        <dl class="popup-grid">
          <dt>Област</dt><dd>${esc(p.oblast)}</dd>
          <dt>Община</dt><dd>${esc(p.obshtina)}</dd>
          <dt>Население</dt><dd>${fmt(Number(p.population))}</dd>
        </dl>
        <span class="popup-badge ${badgeClass}">${badgeText}</span>
      `)
      .addTo(map);
  });

  map.on("mouseenter", "settlements-circle", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "settlements-circle", () => { map.getCanvas().style.cursor = ""; });
}

// Stops layer (lazy loaded with retry support)
async function loadStopsLayer() {
  if (!stopsLoadPromise) {
    stopsLoadPromise = _doLoadStops().catch((err) => {
      stopsLoadPromise = null; // allow retry on failure
      throw err;
    });
  }
  return stopsLoadPromise;
}

async function _doLoadStops() {

  const stopsData = await fetchJSON<GeoJSON.FeatureCollection>("data/stops.geojson");

  map.addSource("stops", {
    type: "geojson",
    data: stopsData,
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 50,
  });

  map.addLayer({
    id: "stops-clusters",
    type: "circle",
    source: "stops",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step", ["get", "point_count"],
        "#51bbd6", 10, "#f1f075", 50, "#f28cb1",
      ],
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 25],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#fff",
    },
  });

  map.addLayer({
    id: "stops-cluster-count",
    type: "symbol",
    source: "stops",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
    },
  });

  map.addLayer({
    id: "stops-unclustered",
    type: "circle",
    source: "stops",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": 4,
      "circle-color": "#2563eb",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Stop popup
  map.on("click", "stops-unclustered", (e) => {
    const f = e.features?.[0];
    if (!f || !f.geometry || f.geometry.type !== "Point") return;
    const p = f.properties as Record<string, unknown>;
    const isZdoi = p.source === "ЗДОИ";
    const docId = prop(p.source_doc_id);
    const sourceBadge = isZdoi
      ? `<span class="popup-badge source-zdoi">ЗДОИ${docId ? " #" + esc(docId) : ""}</span>`
      : `<span class="popup-badge source-bdp">ДАБДП</span>`;
    const city = prop(p.city);
    const road = prop(p.road);
    const roadType = prop(p.road_type);
    const stopTitle = city && road
      ? `${esc(city)} / ${esc(road)}`
      : city ? esc(city) : road ? esc(road) : "Спирка";
    const roadTypeNote = road && roadType ? ` <em>(${esc(roadType)})</em>` : "";
    const sourceDate = prop(p.source_date);
    const dateRow = sourceDate
      ? `<dt>Дата</dt><dd>${esc(sourceDate)}</dd>`
      : "";
    const modifiedDate = prop(p.bdp_modified);
    const modifiedRow = !isZdoi && modifiedDate
      ? `<dt>Посл. промяна</dt><dd>${esc(modifiedDate)}</dd>`
      : "";
    new maplibregl.Popup({ maxWidth: "300px" })
      .setLngLat(f.geometry.coordinates as [number, number])
      .setHTML(`
        <div class="popup-title">${stopTitle}${roadTypeNote}</div>
        <div class="popup-source">${sourceBadge}</div>
        <dl class="popup-grid">
          <dt>Област</dt><dd>${esc(p.oblast || "-")}</dd>
          <dt>Община</dt><dd>${esc(p.municipal || "-")}</dd>
          ${dateRow}
          ${modifiedRow}
        </dl>
      `)
      .addTo(map);
  });

  // Cluster zoom
  map.on("click", "stops-clusters", (e) => {
    const f = e.features?.[0];
    if (!f || !f.geometry || f.geometry.type !== "Point") return;
    const src = map.getSource("stops") as maplibregl.GeoJSONSource;
    src.getClusterExpansionZoom(f.properties!.cluster_id as number).then((zoom) => {
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
    });
  });
}

// Stats update
function updateStats(features: Settlement[]) {
  const total = features.length;
  const withPt = features.filter((f) => f.has_pt_access).length;
  const withoutPt = total - withPt;
  const popTotal = features.reduce((s, f) => s + (f.population || 0), 0);
  const popWithPt = features.filter((f) => f.has_pt_access).reduce((s, f) => s + (f.population || 0), 0);
  const popWithoutPt = popTotal - popWithPt;

  document.getElementById("stat-total")!.textContent = fmt(total);
  document.getElementById("stat-with-pt")!.textContent = fmt(withPt);
  document.getElementById("stat-without-pt")!.textContent = fmt(withoutPt);
  document.getElementById("stat-pct-settlements")!.textContent = total > 0 ? `${((withPt / total) * 100).toFixed(1)}%` : "-";
  document.getElementById("stat-pop-with")!.textContent = fmt(popWithPt);
  document.getElementById("stat-pop-without")!.textContent = fmt(popWithoutPt);
}

// Populate oblast filter
function populateOblastFilter() {
  const select = document.getElementById("filter-oblast") as HTMLSelectElement;
  const oblasts = [...new Set(allSettlements.map((s) => s.oblast))].sort();
  for (const o of oblasts) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    select.appendChild(opt);
  }
}

// Populate municipality filter based on selected oblast
function populateMunicipalityFilter(oblast: string) {
  const select = document.getElementById("filter-municipality") as HTMLSelectElement;
  select.innerHTML = '<option value="">Всички общини</option>';
  if (!oblast) {
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const municipalities = [...new Set(allSettlements.filter((s) => s.oblast === oblast).map((s) => s.obshtina))].sort();
  for (const m of municipalities) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  }
}

// Get current filter state
function getFilters() {
  const oblast = (document.getElementById("filter-oblast") as HTMLSelectElement).value;
  const municipality = (document.getElementById("filter-municipality") as HTMLSelectElement).value;
  const ptStatus = (document.querySelector('input[name="pt-status"]:checked') as HTMLInputElement).value;
  const typeFilter = (document.querySelector('input[name="type-filter"]:checked') as HTMLInputElement).value;
  return { oblast, municipality, ptStatus, typeFilter };
}

// Apply filters
function applyFilters() {
  const { oblast, municipality, ptStatus, typeFilter } = getFilters();

  // Build MapLibre filter
  const conditions: unknown[] = ["all"];
  if (oblast) conditions.push(["==", ["get", "oblast"], oblast]);
  if (municipality) conditions.push(["==", ["get", "obshtina"], municipality]);
  if (ptStatus === "with") conditions.push(["==", ["to-boolean", ["get", "has_pt_access"]], true]);
  if (ptStatus === "without") conditions.push(["==", ["to-boolean", ["get", "has_pt_access"]], false]);
  if (typeFilter === "city") conditions.push(["==", ["get", "type"], "гр."]);
  if (typeFilter === "village") conditions.push(["==", ["get", "type"], "с."]);

  const filter = conditions.length > 1 ? conditions : undefined;
  map.setFilter("settlements-circle", filter as maplibregl.FilterSpecification | undefined);
  if (map.getLayer("settlements-proportional")) {
    map.setFilter("settlements-proportional", filter as maplibregl.FilterSpecification | undefined);
  }

  // Update stats
  let filtered = allSettlements;
  if (oblast) filtered = filtered.filter((s) => s.oblast === oblast);
  if (municipality) filtered = filtered.filter((s) => s.obshtina === municipality);
  if (ptStatus === "with") filtered = filtered.filter((s) => s.has_pt_access);
  if (ptStatus === "without") filtered = filtered.filter((s) => !s.has_pt_access);
  if (typeFilter === "city") filtered = filtered.filter((s) => s.type === "гр.");
  if (typeFilter === "village") filtered = filtered.filter((s) => s.type === "с.");

  updateStats(filtered);
}

// Tables
function renderTable(tableId: string, data: CoverageRow[], sortKey: string = "name", sortAsc: boolean = true) {
  const table = document.getElementById(tableId)!;
  const tbody = table.querySelector("tbody")!;

  const sorted = [...data].sort((a, b) => {
    const va = (a as unknown as Record<string, unknown>)[sortKey];
    const vb = (b as unknown as Record<string, unknown>)[sortKey];
    if (typeof va === "number" && typeof vb === "number") return sortAsc ? va - vb : vb - va;
    return sortAsc ? String(va).localeCompare(String(vb), "bg") : String(vb).localeCompare(String(va), "bg");
  });

  const isOblast = tableId === "oblast-table";

  tbody.innerHTML = sorted
    .map(
      (r) => `
    <tr data-code="${r.code}" data-name="${r.name}">
      <td>${r.name}</td>
      <td class="num">${r.with_pt}/${r.total}</td>
      ${isOblast ? `<td class="num">${r.total}</td>` : ""}
      <td class="num">${r.pct_settlements}%</td>
      ${!isOblast ? `<td class="num">${r.pct_population}%</td>` : ""}
    </tr>
  `
    )
    .join("");

  // Update sort indicators
  table.querySelectorAll("th").forEach((th) => {
    const ind = th.querySelector(".sort-indicator");
    if (ind) ind.remove();
    if (th.dataset.sort === sortKey) {
      const span = document.createElement("span");
      span.className = "sort-indicator";
      span.textContent = sortAsc ? " \u25B2" : " \u25BC";
      th.appendChild(span);
    }
  });
}

function setupTableSort(tableId: string, data: CoverageRow[]) {
  const table = document.getElementById(tableId)!;
  let currentSort = "name";
  let currentAsc = true;

  table.querySelectorAll("th.sortable").forEach((th) => {
    (th as HTMLElement).addEventListener("click", () => {
      const key = (th as HTMLElement).dataset.sort!;
      if (currentSort === key) {
        currentAsc = !currentAsc;
      } else {
        currentSort = key;
        currentAsc = key === "name";
      }
      renderTable(tableId, data, currentSort, currentAsc);
    });
  });

  // Row click -> zoom
  table.querySelector("tbody")!.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest("tr");
    if (!tr) return;
    const name = tr.dataset.name;
    if (!name) return;

    // Find bounds for this area
    const features = allSettlements.filter((s) =>
      tableId === "nuts2-table"
        ? nuts2Data.find((n) => n.name === name && s.nuts2 === n.code)
        : s.oblast === name
    );
    if (features.length === 0) return;

    // O(1) lookup via pre-built coordinate index
    const lons: number[] = [];
    const lats: number[] = [];
    for (const f of features) {
      const coord = coordIndex.get(f.ekatte);
      if (coord) { lons.push(coord[0]); lats.push(coord[1]); }
    }

    if (lons.length === 0) return;

    map.fitBounds(
      [[Math.min(...lons) - 0.1, Math.min(...lats) - 0.05], [Math.max(...lons) + 0.1, Math.max(...lats) + 0.05]],
      { padding: 40, duration: 1000 }
    );

    // Highlight boundary
    if (tableId === "oblast-table") {
      highlightOblast(name);
      highlightMunicipality(null);
    } else {
      // NUTS2: highlight all oblasts in the region
      const nuts2Code = nuts2Data.find((n) => n.name === name)?.code;
      if (nuts2Code) {
        highlightNuts2(nuts2Code);
      }
      highlightMunicipality(null);
    }

    // Highlight row
    table.querySelectorAll("tr.active").forEach((r) => r.classList.remove("active"));
    tr.classList.add("active");
  });
}

// Search
function setupSearch() {
  const input = document.getElementById("search-input") as HTMLInputElement;
  const resultsDiv = document.getElementById("search-results")!;
  let debounceTimer: number;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      const query = input.value.trim().toLowerCase();
      if (query.length < 2) {
        resultsDiv.hidden = true;
        return;
      }

      const matches = allSettlements
        .filter((s) => s.name.toLowerCase().includes(query) || s.ekatte.includes(query))
        .slice(0, 10);

      if (matches.length === 0) {
        resultsDiv.hidden = true;
        return;
      }

      resultsDiv.innerHTML = matches
        .map(
          (s) =>
            `<div class="search-item" data-ekatte="${s.ekatte}">
              ${s.name} <span class="search-meta">(${s.obshtina}, обл. ${s.oblast})</span>
            </div>`
        )
        .join("");
      resultsDiv.hidden = false;
    }, 200);
  });

  resultsDiv.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".search-item") as HTMLElement | null;
    if (!item) return;
    const ekatte = item.dataset.ekatte;
    const feature = settlementsData.features.find(
      (f) => (f.properties as Record<string, unknown>).ekatte === ekatte
    );
    if (feature?.geometry?.type === "Point") {
      map.flyTo({
        center: feature.geometry.coordinates as [number, number],
        zoom: 13,
        duration: 1000,
      });

      // Trigger popup
      setTimeout(() => {
        const p = feature.properties as Record<string, unknown>;
        const hasPt = p.has_pt_access === true || p.has_pt_access === "true";
        new maplibregl.Popup({ maxWidth: "280px" })
          .setLngLat((feature.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(`
            <div class="popup-title">${esc(p.name)}</div>
            <div class="popup-ekatte">ЕКАТТЕ: ${esc(p.ekatte)} | ${p.type === "гр." ? "Град" : "Село"}</div>
            <dl class="popup-grid">
              <dt>Област</dt><dd>${esc(p.oblast)}</dd>
              <dt>Община</dt><dd>${esc(p.obshtina)}</dd>
              <dt>Население</dt><dd>${fmt(Number(p.population))}</dd>
            </dl>
            <span class="popup-badge ${hasPt ? "has-pt" : "no-pt"}">${hasPt ? `${p.stop_count} спирки` : "Без ОТ"}</span>
          `)
          .addTo(map);
      }, 1100);
    }
    resultsDiv.hidden = true;
    input.value = "";
  });

  // Close on click outside
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".search-wrapper")) {
      resultsDiv.hidden = true;
    }
  });

  // Keyboard navigation
  input.addEventListener("keydown", (e) => {
    const items = resultsDiv.querySelectorAll(".search-item");
    const active = resultsDiv.querySelector(".search-item.active");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!active) items[0]?.classList.add("active");
      else {
        active.classList.remove("active");
        (active.nextElementSibling as HTMLElement)?.classList.add("active");
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (active) {
        active.classList.remove("active");
        (active.previousElementSibling as HTMLElement)?.classList.add("active");
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      (active as HTMLElement)?.click();
    } else if (e.key === "Escape") {
      resultsDiv.hidden = true;
    }
  });
}

// CSV export
function setupCSVExport() {
  document.getElementById("btn-csv")!.addEventListener("click", () => {
    const { oblast, municipality, ptStatus, typeFilter } = getFilters();
    let data = allSettlements;
    if (oblast) data = data.filter((s) => s.oblast === oblast);
    if (municipality) data = data.filter((s) => s.obshtina === municipality);
    if (ptStatus === "with") data = data.filter((s) => s.has_pt_access);
    if (ptStatus === "without") data = data.filter((s) => !s.has_pt_access);
    if (typeFilter === "city") data = data.filter((s) => s.type === "гр.");
    if (typeFilter === "village") data = data.filter((s) => s.type === "с.");

    const csvEsc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = "ЕКАТТЕ,Име,Тип,Област,Община,Население,ОТ достъп,Брой спирки\n";
    const rows = data
      .map(
        (s) =>
          `${s.ekatte},${csvEsc(s.name)},${csvEsc(s.type)},${csvEsc(s.oblast)},${csvEsc(s.obshtina)},${s.population},${s.has_pt_access ? "Да" : "Не"},${s.stop_count}`
      )
      .join("\n");

    const bom = "\uFEFF";
    const blob = new Blob([bom + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `byala-karta-ot-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Boundary layers (oblast + municipality polygons)
async function loadBoundaries() {
  if (boundariesLoaded) return;
  boundariesLoaded = true;

  const [oblastsGJ, munisGJ] = await Promise.all([
    fetchJSON<GeoJSON.FeatureCollection>("data/oblasts_boundaries.geojson"),
    fetchJSON<GeoJSON.FeatureCollection>("data/municipalities_boundaries.geojson"),
  ]);

  // Add Bulgarian name to each feature for easy filtering
  for (const f of oblastsGJ.features) {
    const latin = (f.properties as Record<string, string>).shapeName;
    (f.properties as Record<string, string>).bg_name = OBLAST_NAME_MAP[latin] || latin;
  }

  // Build municipality Latin name lookup: for each BG obshtina name, find matching geoBoundaries shapeName
  // Strategy: compare lowercase Latin names from geoBoundaries with our settlement name_en values
  const bgObshtinaToSettlementNames = new Map<string, Set<string>>();
  for (const s of allSettlements) {
    const en = (s as unknown as Record<string, string>).name_en;
    if (s.obshtina && en) {
      if (!bgObshtinaToSettlementNames.has(s.obshtina)) bgObshtinaToSettlementNames.set(s.obshtina, new Set());
      bgObshtinaToSettlementNames.get(s.obshtina)!.add(en.toLowerCase());
    }
  }
  for (const f of munisGJ.features) {
    const shapeName = (f.properties as Record<string, string>).shapeName;
    const shapeNameLower = shapeName.toLowerCase();
    // Match: municipality shapeName matches a settlement name_en in that obshtina
    for (const [bgName, nameSet] of bgObshtinaToSettlementNames) {
      if (nameSet.has(shapeNameLower)) {
        muniLatinNames.set(bgName, shapeName);
        break;
      }
    }
  }

  map.addSource("oblast-boundaries", { type: "geojson", data: oblastsGJ });
  map.addSource("municipality-boundaries", { type: "geojson", data: munisGJ });

  // Oblast highlight layers (below settlements)
  map.addLayer({
    id: "oblast-highlight-fill",
    type: "fill",
    source: "oblast-boundaries",
    paint: { "fill-color": "rgba(217,119,6,0.1)" },
    filter: ["==", "bg_name", ""],
  }, "settlements-circle");

  map.addLayer({
    id: "oblast-highlight-line",
    type: "line",
    source: "oblast-boundaries",
    paint: { "line-color": "#d97706", "line-width": 3 },
    filter: ["==", "bg_name", ""],
  }, "settlements-circle");

  // Municipality highlight layers
  map.addLayer({
    id: "muni-highlight-fill",
    type: "fill",
    source: "municipality-boundaries",
    paint: { "fill-color": "rgba(217,119,6,0.15)" },
    filter: ["==", "shapeName", ""],
  }, "settlements-circle");

  map.addLayer({
    id: "muni-highlight-line",
    type: "line",
    source: "municipality-boundaries",
    paint: { "line-color": "#d97706", "line-width": 2, "line-dasharray": [4, 2] },
    filter: ["==", "shapeName", ""],
  }, "settlements-circle");
}

function highlightOblast(bgName: string | null) {
  if (!boundariesLoaded) return;
  if (bgName) {
    map.setFilter("oblast-highlight-fill", ["==", ["get", "bg_name"], bgName]);
    map.setFilter("oblast-highlight-line", ["==", ["get", "bg_name"], bgName]);
  } else {
    map.setFilter("oblast-highlight-fill", ["==", "bg_name", ""]);
    map.setFilter("oblast-highlight-line", ["==", "bg_name", ""]);
  }
}

function highlightNuts2(nuts2Code: string) {
  if (!boundariesLoaded) return;
  // Find all oblasts in this NUTS2 region
  const oblastsInRegion = [...new Set(allSettlements.filter((s) => s.nuts2 === nuts2Code).map((s) => s.oblast))];
  // Use "in" filter to highlight multiple oblasts at once
  if (oblastsInRegion.length > 0) {
    const bgNames = oblastsInRegion;
    map.setFilter("oblast-highlight-fill", ["in", ["get", "bg_name"], ["literal", bgNames]]);
    map.setFilter("oblast-highlight-line", ["in", ["get", "bg_name"], ["literal", bgNames]]);
  }
}

function highlightMunicipality(latinName: string | null) {
  if (!boundariesLoaded) return;
  if (latinName) {
    map.setFilter("muni-highlight-fill", ["==", ["get", "shapeName"], latinName]);
    map.setFilter("muni-highlight-line", ["==", ["get", "shapeName"], latinName]);
  } else {
    map.setFilter("muni-highlight-fill", ["==", "shapeName", ""]);
    map.setFilter("muni-highlight-line", ["==", "shapeName", ""]);
  }
}

function fitToFilteredArea() {
  const { oblast, municipality } = getFilters();

  // Try to fitBounds to a highlighted boundary polygon
  if (oblast && boundariesLoaded) {
    const source = municipality
      ? map.getSource("municipality-boundaries") as maplibregl.GeoJSONSource
      : map.getSource("oblast-boundaries") as maplibregl.GeoJSONSource;

    // Get the matching feature's bounds from coordIndex
    const matchingSettlements = allSettlements.filter((s) => {
      if (municipality) return s.oblast === oblast && s.obshtina === municipality;
      return s.oblast === oblast;
    });

    if (matchingSettlements.length > 0) {
      const lons: number[] = [];
      const lats: number[] = [];
      for (const s of matchingSettlements) {
        const c = coordIndex.get(s.ekatte);
        if (c) { lons.push(c[0]); lats.push(c[1]); }
      }
      if (lons.length > 0) {
        map.fitBounds(
          [[Math.min(...lons) - 0.05, Math.min(...lats) - 0.03],
           [Math.max(...lons) + 0.05, Math.max(...lats) + 0.03]],
          { padding: 40, duration: 1000 }
        );
      }
    }
  } else {
    // No oblast filter: fit to all visible settlements or reset to national view
    const filtered = getFilteredSettlements();
    if (filtered.length === allSettlements.length) {
      // Reset to national view
      map.flyTo({ center: [25.5, 42.7], zoom: 7, duration: 1000 });
    } else if (filtered.length > 0) {
      const lons: number[] = [];
      const lats: number[] = [];
      for (const s of filtered) {
        const c = coordIndex.get(s.ekatte);
        if (c) { lons.push(c[0]); lats.push(c[1]); }
      }
      if (lons.length > 0) {
        map.fitBounds(
          [[Math.min(...lons) - 0.05, Math.min(...lats) - 0.03],
           [Math.max(...lons) + 0.05, Math.max(...lats) + 0.03]],
          { padding: 40, duration: 1000 }
        );
      }
    }
  }
}

function getFilteredSettlements(): Settlement[] {
  const { oblast, municipality, ptStatus, typeFilter } = getFilters();
  let filtered = allSettlements;
  if (oblast) filtered = filtered.filter((s) => s.oblast === oblast);
  if (municipality) filtered = filtered.filter((s) => s.obshtina === municipality);
  if (ptStatus === "with") filtered = filtered.filter((s) => s.has_pt_access);
  if (ptStatus === "without") filtered = filtered.filter((s) => !s.has_pt_access);
  if (typeFilter === "city") filtered = filtered.filter((s) => s.type === "гр.");
  if (typeFilter === "village") filtered = filtered.filter((s) => s.type === "с.");
  return filtered;
}

// Find Latin municipality name from Bulgarian obshtina name
function findMuniLatinName(bgObshtina: string): string | null {
  return MUNI_NAME_OVERRIDES[bgObshtina] || muniLatinNames.get(bgObshtina) || null;
}

// Layer toggles
function setupLayerToggles() {
  document.getElementById("layer-settlements")!.addEventListener("change", (e) => {
    const visible = (e.target as HTMLInputElement).checked ? "visible" : "none";
    map.setLayoutProperty("settlements-circle", "visibility", visible);
  });

  document.getElementById("layer-stops")!.addEventListener("change", async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      await loadStopsLayer();
    }
    if (stopsLoadPromise) {
      const visible = checked ? "visible" : "none";
      for (const layerId of ["stops-clusters", "stops-cluster-count", "stops-unclustered"]) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible);
      }
    }
  });

  document.getElementById("layer-circles")!.addEventListener("change", (e) => {
    const visible = (e.target as HTMLInputElement).checked ? "visible" : "none";
    map.setLayoutProperty("settlements-proportional", "visibility", visible);
  });
}

// Sidebar mobile toggle
function setupSidebar() {
  const sidebar = document.getElementById("sidebar")!;
  const backdrop = document.getElementById("sidebar-backdrop")!;

  function closeSidebar() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("visible");
  }

  function openSidebar() {
    sidebar.classList.add("open");
    backdrop.classList.add("visible");
  }

  document.getElementById("sidebar-toggle")!.addEventListener("click", closeSidebar);
  document.getElementById("sidebar-open")!.addEventListener("click", openSidebar);
  backdrop.addEventListener("click", closeSidebar);
}

// Main
async function main() {
  showLoading();
  setupSidebar();

  try {
    // Load data in parallel
    const [settlementsGJ, nuts2, oblast, meta] = await Promise.all([
      fetchJSON<GeoJSON.FeatureCollection>("data/settlements.geojson"),
      fetchJSON<CoverageRow[]>("data/coverage_nuts2.json"),
      fetchJSON<CoverageRow[]>("data/coverage_oblast.json"),
      fetchJSON<Metadata>("data/metadata.json"),
    ]);

    settlementsData = settlementsGJ;
    nuts2Data = nuts2;
    oblastData = oblast;
    metadata = meta;

    // Extract settlement data for filtering/stats
    allSettlements = settlementsGJ.features.map((f) => f.properties as unknown as Settlement);

    // Build coordinate index for O(1) lookups (used by table click-to-zoom)
    for (const f of settlementsGJ.features) {
      const p = f.properties as Record<string, unknown>;
      if (f.geometry?.type === "Point") {
        coordIndex.set(String(p.ekatte), f.geometry.coordinates as [number, number]);
      }
    }

    // Init map
    map = initMap();

    map.on("load", () => {
      addSettlementLayer();
      // Delay fitBounds slightly so map container has final dimensions
      setTimeout(() => fitToBulgaria(), 100);
      hideLoading();

      // Stats
      updateStats(allSettlements);

      // Filters
      populateOblastFilter();

      // Load boundary data (fire and forget - non-blocking)
      loadBoundaries();

      document.getElementById("filter-oblast")!.addEventListener("change", (e) => {
        const oblast = (e.target as HTMLSelectElement).value;
        populateMunicipalityFilter(oblast);
        applyFilters();
        highlightOblast(oblast || null);
        highlightMunicipality(null);
        if (oblast) fitToFilteredArea();
        else map.flyTo({ center: [25.5, 42.7], zoom: 7, duration: 1000 });
      });

      document.getElementById("filter-municipality")!.addEventListener("change", () => {
        applyFilters();
        const oblast = (document.getElementById("filter-oblast") as HTMLSelectElement).value;
        const municipality = (document.getElementById("filter-municipality") as HTMLSelectElement).value;
        if (municipality) {
          const latinName = findMuniLatinName(municipality);
          highlightMunicipality(latinName);
          highlightOblast(null);
          fitToFilteredArea();
        } else if (oblast) {
          highlightMunicipality(null);
          highlightOblast(oblast);
          fitToFilteredArea();
        }
      });
      document.querySelectorAll('input[name="pt-status"]').forEach((r) =>
        r.addEventListener("change", () => applyFilters())
      );
      document.querySelectorAll('input[name="type-filter"]').forEach((r) =>
        r.addEventListener("change", () => applyFilters())
      );

      // Tables
      renderTable("nuts2-table", nuts2Data);
      setupTableSort("nuts2-table", nuts2Data);
      renderTable("oblast-table", oblastData, "pct_settlements", false);
      setupTableSort("oblast-table", oblastData);

      // Search
      setupSearch();

      // CSV
      setupCSVExport();

      // Layers
      setupLayerToggles();

      // Metadata
      const lastUpdated = document.getElementById("last-updated")!;
      const date = new Date(metadata.generated_at);
      lastUpdated.textContent = `Данни от: ${date.toLocaleDateString("bg-BG")}`;
    });

    // Nav controls
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new ResetControl() as unknown as maplibregl.IControl, "top-right");
  } catch (err) {
    hideLoading();
    console.error("Failed to load data:", err);
    document.getElementById("map")!.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;">
        <div style="font-size:48px;">&#9888;</div>
        <div>Грешка при зареждане на данните. Моля, опитайте отново.</div>
      </div>
    `;
  }
}

main();
