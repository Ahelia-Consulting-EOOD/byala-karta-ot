# Technical Specification: PT Accessibility Gap Visualization Dashboard

## Document Overview

This specification defines the technology stack, visualization techniques, and multi-layer architecture for an interactive web map dashboard that displays public transport (PT) accessibility gaps across Bulgaria. The dashboard will visualize 10,284 bus stops, 453 stations, and approximately 5,257 settlements to identify "white zones" - areas with inadequate PT coverage.

**Data scale:** 10,284 stop points (3.4 MB GeoJSON), ~5,257 settlements, 179 municipalities, 28 oblasts. This is a moderate dataset that does not require extreme optimization but benefits from efficient rendering for smooth interactivity.

---

## 1. Base Map and Visualization Techniques

### 1.1 OSM Tile Servers

Three approaches exist for serving OpenStreetMap base map tiles. The choice affects styling flexibility, performance, and operational cost.

#### Raster Tiles (tile.openstreetmap.org)

The default OSM tile server delivers pre-rendered 256x256 PNG tiles at zoom levels 0-19. Tiles are styled with the standard Mapnik stylesheet - a colorful general-purpose cartography that cannot be customized client-side.

- **Pros:** Zero infrastructure, no API key, instant setup
- **Cons:** Fixed styling (cannot mute colors or highlight transport), heavy visual weight competes with data overlays, usage policy limits to 250,000 tiles/day with mandatory attribution
- **Verdict:** Unsuitable for a PT-focused analytical dashboard. The fixed bright styling distracts from data layers.

#### Vector Tiles - Hosted (MapTiler, Stadia Maps)

Commercial providers serve pre-generated vector tiles (MVT format) via API. MapTiler Cloud offers a free tier of 100,000 tile requests/month.

- **MapTiler:** Provides basemap styles including "Mute" and "Dataviz" optimized for data overlay. SDK available. Free tier sufficient for development; production starts at EUR 55/month.
- **Stadia Maps:** Offers Stamen-derived styles (Toner, Terrain) suitable for analytical overlays. Free tier: 200,000 map views/month.
- **Pros:** No infrastructure, customizable styles via MapLibre Style Spec, smooth zoom/rotation
- **Cons:** Recurring cost, dependency on third-party service availability

#### Vector Tiles - Self-Hosted (Protomaps PMTiles + OpenMapTiles)

**Recommended approach.** Two complementary technologies enable zero-server vector tile hosting:

**PMTiles** (https://protomaps.com/, v4 format): A single-file archive format that stores pre-rendered vector tiles with internal spatial indexing. The browser fetches only the needed tiles via HTTP Range Requests - no tile server required. A Bulgaria extract is approximately 300-500 MB.

**OpenMapTiles** (https://openmaptiles.org/): Provides the vector tile schema (layers: transportation, buildings, water, landuse, etc.) and styling. The `openmaptiles` schema is the de facto standard consumed by MapLibre GL JS styles.

**Workflow to produce a Bulgaria PMTiles basemap:**
```bash
# 1. Download Bulgaria OSM extract
wget https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf

# 2. Generate vector tiles with tilemaker (or planetiler)
tilemaker --input bulgaria-latest.osm.pbf \
          --output bulgaria.pmtiles \
          --config config.json \
          --process process.lua

# 3. Host the .pmtiles file on any static file server (S3, Cloudflare R2, nginx)
# No tile server process needed - the browser reads directly via HTTP Range Requests
```

**Cost:** Static file hosting only. On Cloudflare R2: ~$0.015/GB storage + $0.36/million Range Requests. For a dashboard with 100 daily users, this is effectively free.

**Custom styling for PT focus:** Create a MapLibre style JSON that mutes land/building colors to light grays and highlights transportation infrastructure (roads, railways) in contrasting colors:

```json
{
  "id": "transportation",
  "type": "line",
  "source": "openmaptiles",
  "source-layer": "transportation",
  "filter": ["all", ["==", "class", "bus"]],
  "paint": {
    "line-color": "#2563eb",
    "line-width": 2,
    "line-opacity": 0.7
  }
}
```

### 1.2 Map Styling for PT Analysis

The base map must recede visually so data overlays dominate. Key principles:

| Element | Style | Rationale |
|---------|-------|-----------|
| Land | `#f8f9fa` (near-white) | Maximum contrast for colored overlays |
| Buildings | `#e9ecef` (light gray) | Visible for orientation, not dominant |
| Water | `#dbeafe` (pale blue) | Standard geographic reference |
| Roads (major) | `#adb5bd` (medium gray) | Network context without competition |
| Roads (minor) | `#dee2e6` (light gray) | Background texture only |
| Railways | `#6366f1` (indigo), dashed | Highlighted - PT infrastructure |
| Labels | `#6b7280`, 11px | Readable but not prominent |

This produces a "dataviz" base map similar to MapTiler's Dataviz style or CartoDB Positron. The muted palette ensures that red/green settlement markers and heat map overlays remain the visual focus.

### 1.3 Heat Map Techniques for Transport Poverty

Four techniques are evaluated for visualizing PT accessibility intensity across Bulgaria's territory.

#### 1.3.1 Kernel Density Estimation (KDE)

KDE produces a continuous surface from discrete stop locations, showing where PT coverage concentrates. The result is a smooth heat map where "hot" areas have many nearby stops.

**Implementation:** Deck.gl `HeatmapLayer` (v9.2) uses GPU-accelerated Gaussian KDE internally.

```typescript
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

const heatLayer = new HeatmapLayer({
  id: 'stop-density',
  data: stops,
  getPosition: (d: Stop) => [d.lon, d.lat],
  getWeight: 1,
  radiusPixels: 30,       // kernel radius in screen pixels
  intensity: 1,
  threshold: 0.05,        // minimum weight to render
  colorRange: [
    [255, 255, 178],       // low density (yellow)
    [253, 141, 60],        // medium (orange)
    [189, 0, 38]           // high density (dark red)
  ],
  aggregation: 'SUM'
});
```

**Bandwidth selection:** For Bulgaria's geography (approximately 500km x 300km, ~5,257 settlements), a radius of 2-5 km in geographic units captures meaningful PT coverage zones. At zoom level 10, this translates to approximately 20-50 screen pixels. The radius should adapt to zoom level - MapLibre's native `heatmap-radius` property supports zoom-dependent expressions.

**Limitation:** KDE shows stop density, not service quality. A cluster of 20 stops with 1 bus/day looks identical to 20 stops with 50 buses/day. KDE is appropriate for Phase 1 (binary presence) but insufficient for Level 2+ indicators.

#### 1.3.2 Inverse Distance Weighting (IDW)

IDW interpolates a continuous surface where each settlement's PT access score is weighted by distance to nearby stops. Unlike KDE (which counts stops), IDW answers: "How far is the nearest PT from any point on the map?"

**Use case:** Ideal for visualizing "distance to nearest stop" as a continuous surface. Settlements >1km from any stop appear as cold zones.

**Implementation:** Not natively available in MapLibre or Deck.gl. Requires pre-computation:

```typescript
// Pre-compute IDW surface as a grid of points
function idwInterpolation(
  queryPoint: [number, number],
  stops: Array<{ lon: number; lat: number }>,
  power: number = 2,
  maxDistance: number = 5000  // meters
): number {
  let weightSum = 0;
  let valueSum = 0;
  for (const stop of stops) {
    const dist = haversineDistance(queryPoint, [stop.lon, stop.lat]);
    if (dist < 1) return 1.0; // at a stop
    if (dist > maxDistance) continue;
    const weight = 1 / Math.pow(dist, power);
    weightSum += weight;
    valueSum += weight; // each stop contributes value=1
  }
  return weightSum > 0 ? valueSum / weightSum : 0;
}
```

**Performance:** For 10,284 stops and a 1km grid across Bulgaria (~150,000 grid cells), the computation takes ~2-5 seconds in JavaScript. Pre-compute and serve as a raster tile layer.

#### 1.3.3 Hexagonal Binning (H3)

H3 (https://h3geo.org/, v4.x) partitions the earth's surface into hexagonal cells at 16 resolution levels. Each cell aggregates the PT access score of the area it covers.

**Why hexagons over squares:** Hexagons have uniform adjacency (6 neighbors vs 8 for squares with unequal edge/corner distances), better approximate circles, and reduce sampling bias in spatial aggregation.

**Resolution selection for Bulgaria:**

| H3 Resolution | Avg Cell Area | Cells for Bulgaria | Use Case |
|---------------|---------------|-------------------|----------|
| 4 | 1,770 km2 | ~65 | Oblast-level overview |
| 5 | 253 km2 | ~440 | Regional patterns |
| 6 | 36 km2 | ~3,100 | Municipality-level analysis |
| 7 | 5.2 km2 | ~21,600 | Settlement-level detail |
| 8 | 0.74 km2 | ~150,000 | Sub-settlement precision |

**Recommended:** Resolution 7 for the primary analysis view. Each cell (~5 km2) covers a settlement-sized area and aggregates: (a) number of bus stops within the cell, (b) population count (from EKATTE data), and (c) derived PT access ratio. ~21,600 cells is well within browser rendering capacity.

```typescript
import { H3HexagonLayer } from '@deck.gl/geo-layers';

const h3Layer = new H3HexagonLayer({
  id: 'pt-access-hexagons',
  data: hexagonData,  // pre-computed array of {h3Index, stopCount, population, accessScore}
  getHexagon: (d: HexData) => d.h3Index,
  getFillColor: (d: HexData) => {
    // Red (no access) to Green (good access)
    const score = d.accessScore;  // 0-1
    return [
      Math.round(255 * (1 - score)),  // R
      Math.round(200 * score),        // G
      50,                              // B
      160                              // Alpha
    ];
  },
  getElevation: (d: HexData) => d.population,
  extruded: false,
  pickable: true,
  stroked: true,
  lineWidthMinPixels: 1
});
```

#### 1.3.4 Voronoi / Thiessen Polygons for Service Areas

Voronoi tessellation partitions the map into polygons where each polygon contains all points closer to a specific bus stop than to any other stop. This directly answers: "Which stop serves each location?"

**Use case:** Service area delineation. Color each polygon by the distance from its farthest point to the generating stop - large, uniformly-colored polygons indicate sparse coverage.

**Implementation:** Use d3-delaunay (v6.0.4) to compute Voronoi from stop coordinates, then render as a GeoJSON polygon layer:

```typescript
import { Delaunay } from 'd3-delaunay';

const points = stops.map(s => [s.lon, s.lat] as [number, number]);
const delaunay = Delaunay.from(points);
const voronoi = delaunay.voronoi([20.0, 41.0, 29.0, 44.5]); // Bulgaria bounding box

const voronoiGeoJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: stops.map((stop, i) => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [voronoi.cellPolygon(i)]
    },
    properties: {
      stopId: stop.id,
      oblast: stop.oblast,
      // area will be computed to indicate coverage sparseness
    }
  }))
};
```

**Performance:** Computing Voronoi for 10,284 points takes <100ms. Rendering 10,284 polygons is straightforward for MapLibre GL JS with WebGL.

**Limitation:** Voronoi assumes Euclidean distance. In mountainous Bulgaria, actual travel distance to a stop may differ significantly from straight-line distance. This is acceptable for Phase 1 analysis but should be noted.

### 1.4 Proportional Circles and Choropleths

#### Proportional Circles (Settlement Markers)

Each of the ~5,257 settlements is shown as a circle:
- **Size:** Proportional to population (sqrt scaling to prevent large cities from dominating)
- **Color:** Gradient from red (no PT access) through yellow (partial) to green (good coverage)

```typescript
// MapLibre GL JS data-driven styling
map.addLayer({
  id: 'settlements',
  type: 'circle',
  source: 'settlements',
  paint: {
    'circle-radius': [
      'interpolate', ['linear'],
      ['sqrt', ['get', 'population']],
      0, 3,       // population 0 -> 3px
      10, 5,      // population 100 -> 5px
      50, 10,     // population 2500 -> 10px
      100, 15,    // population 10000 -> 15px
      400, 30     // population 160000 -> 30px (Sofia)
    ],
    'circle-color': [
      'interpolate', ['linear'],
      ['get', 'accessScore'],
      0, '#dc2626',     // red - no access
      0.3, '#f97316',   // orange - poor
      0.6, '#eab308',   // yellow - partial
      1.0, '#16a34a'    // green - good
    ],
    'circle-opacity': 0.8,
    'circle-stroke-width': 1,
    'circle-stroke-color': '#ffffff'
  }
});
```

#### Choropleth Maps

Municipality-level (179 polygons) or oblast-level (28 polygons) filled areas showing aggregate PT access scores. Requires administrative boundary GeoJSON (sourced from GADM or OpenStreetMap extracts).

Color scale: Sequential single-hue (e.g., white-to-dark-red for "% population without PT access") using 5-7 Jenks natural breaks for class boundaries.

```typescript
map.addLayer({
  id: 'municipality-choropleth',
  type: 'fill',
  source: 'admin-boundaries',
  paint: {
    'fill-color': [
      'step',
      ['get', 'pctWithoutPT'],
      '#fee5d9',    // 0-20%
      20, '#fcae91',
      40, '#fb6a4a',
      60, '#de2d26',
      80, '#a50f15'  // 80-100%
    ],
    'fill-opacity': 0.6
  }
});
```

---

## 2. Technical Stack Evaluation

### 2.1 Client-Side Mapping Libraries

Four libraries are evaluated against this project's specific requirements: 10,284 stops + ~5,257 settlements (total ~15,500 points), multi-layer compositing, data-driven styling, and future extensibility.

#### Comparison Matrix

| Criterion | Leaflet 1.9.4 / 2.0-alpha | MapLibre GL JS v5.22.0 | Deck.gl v9.2 | Kepler.gl v3.3.0-alpha |
|-----------|---------------------------|----------------------|-------------|----------------------|
| **Rendering** | DOM/Canvas (no WebGL) | WebGL (WebGPU planned) | WebGL2/WebGPU | WebGL (via Deck.gl) |
| **Vector tiles** | Via plugin only | Native, first-class | Via MapLibre base | Via MapLibre base |
| **Max points (smooth)** | ~10,000 without clustering | ~100,000+ | ~1,000,000+ | ~1,000,000+ |
| **Data-driven styling** | Manual, per-feature | Expressions in style spec | Accessor functions | GUI-driven |
| **Layer compositing** | Z-index panes (limited) | Style layers (flexible) | Layer array (excellent) | Preset layer types |
| **Mobile support** | Excellent | Good (WebGL required) | Limited (touch issues) | Poor (desktop-focused) |
| **Bundle size (gzipped)** | ~42 KB | ~260 KB | ~350 KB (core) | ~1.5 MB |
| **Learning curve** | Low | Medium | High | Low (GUI) |
| **Choropleth** | Plugin (leaflet-choropleth) | Native fill layer | GeoJsonLayer | Native |
| **Heat map** | leaflet.heat plugin | Native heatmap layer | HeatmapLayer (GPU) | Native |
| **Clustering** | leaflet.markercluster | Native clustering | Aggregation layers | Native |
| **URL** | https://leafletjs.com | https://maplibre.org | https://deck.gl | https://kepler.gl |

#### Detailed Evaluation

**Leaflet 1.9.4** (stable) / **2.0.0-alpha.1** (August 2025)

Leaflet's DOM/Canvas rendering handles our 15,500 points adequately but without headroom. The markercluster plugin (v1.5.3, last updated 2022) is battle-tested but unmaintained. Leaflet lacks native vector tile support - the `leaflet-mapbox-gl` bridge plugin is a workaround, not a solution. The 2.0 alpha drops IE support and modernizes the API (`new Marker(latlng)` replaces `L.marker(latlng)`) but is not production-ready.

**Verdict:** Adequate for a simple Phase 1 prototype but will constrain future growth. Not recommended.

**MapLibre GL JS v5.22.0** (April 2025) -- RECOMMENDED

WebGL-accelerated rendering with native vector tile consumption, data-driven styling expressions, built-in clustering, and smooth 60fps interaction. The style specification provides declarative layer compositing - layers are ordered in a JSON style document and rendered via the GPU pipeline. Native heatmap layer type with zoom-adaptive radius. Built-in GeoJSON source with automatic tiling (geojson-vt) for datasets up to several MB.

Performance for our dataset: 10,284 stop points render as a single draw call via the `circle` layer type. No clustering needed at zoom > 10. Built-in clustering with `clusterRadius: 50` handles zoom levels 0-9. MapLibre's own documentation recommends `maxZoom: 12` for point sources to optimize tile generation.

The library is actively maintained with weekly releases (v5.22.0 is the 22nd release in the v5 series). The MapLibre ecosystem includes Martin (tile server), MapLibre Native (mobile), and the Style Specification - a coherent stack.

**Verdict:** Best fit. Native vector tiles, sufficient performance, moderate complexity, strong ecosystem.

**Deck.gl v9.2** (October 2025)

Deck.gl excels at rendering massive datasets (millions of points) with GPU acceleration. Its `HeatmapLayer` performs Gaussian KDE entirely on the GPU. The `H3HexagonLayer` renders H3 hexagons natively. However, Deck.gl is a visualization layer, not a full mapping library - it requires a base map (MapLibre or Google Maps) underneath.

For our 15,500 points, Deck.gl is overkill. Its strengths (million-point rendering, WebGPU) are not needed. However, it becomes valuable for future H3 hexagonal analysis and dense heat maps.

**Verdict:** Not needed as the primary library. Use selectively via `@deck.gl/maplibre` overlay for H3 and advanced heat map layers when needed.

**Kepler.gl v3.3.0-alpha.0** (April 2024)

Kepler.gl is a high-level analytical tool built on Deck.gl and MapLibre. It provides a complete GUI for data exploration - drag-and-drop CSV/GeoJSON, automatic layer creation, filter widgets, AI assistant. Recent versions add DuckDB integration and PMTiles raster support.

However, Kepler.gl is an application, not a library. Embedding it as a React component (`KeplerGl`) brings its entire UI, which is difficult to customize. It is excellent for rapid prototyping and data exploration but not suitable as the foundation for a purpose-built dashboard.

**Verdict:** Useful as an internal exploration tool during development. Not suitable as the production dashboard framework.

### 2.2 Server-Side Tile Serving

For vector tile serving from PostGIS, three options are compared.

| Server | Language | Version | PostGIS Support | PMTiles | Performance Rank |
|--------|----------|---------|----------------|---------|-----------------|
| **Martin** | Rust | v1.5.0 (Apr 2026) | Auto-discovery of tables/functions | Yes (local + HTTP) | 1st (fastest) |
| **pg_tileserv** | Go | v1.0.14 | Tables + functions | No | 2nd |
| **GeoServer** | Java | v2.28.0 | Via data store | Via plugin | 3rd (heaviest) |

**Martin** (https://martin.maplibre.org/) is the recommended choice:
- Written in Rust with Actix-web, consistently benchmarked as the fastest PostGIS vector tile server
- Automatically discovers PostGIS tables and functions, generates MVT tiles on-the-fly
- Serves PMTiles and MBTiles files directly - dual role as both dynamic and static tile server
- Includes `martin-cp` for bulk tile pre-generation
- Apache 2.0 / MIT dual licensed, part of the MapLibre ecosystem

**pg_tileserv** is simpler to configure (single binary, auto-discovers tables) but lacks PMTiles support and is measurably slower than Martin.

**GeoServer** is a full OGC-compliant server supporting WMS, WFS, WCS, WMTS, and OGC API Features. It is significantly heavier (Java, requires servlet container) but may be needed for ESRI/NAP interoperability (see Section 2.4). Consider running GeoServer only if WFS/WMS endpoints are a hard requirement for NAP integration.

**Recommendation for this project:** Martin as the primary tile server. If WFS/WMS is required for NAP, add GeoServer as a secondary facade, or use OGC API Features endpoints (see Section 2.4).

### 2.3 Data Format Evaluation

The dashboard needs to serve geographic data to the browser. The choice of format affects load time, memory use, and hosting complexity.

| Format | Type | File Size (10K points) | Load Time (browser) | Partial Loading | Server Required |
|--------|------|----------------------|--------------------|-----------------|----|
| **GeoJSON** | Text/JSON | ~3.4 MB (actual) | ~200ms (parse) | No (all-or-nothing) | No |
| **FlatGeobuf** | Binary | ~1.4 MB (est. 40% of GeoJSON) | ~50ms | Yes (spatial index) | No (HTTP Range) |
| **PMTiles** | Binary (tiled) | ~0.5 MB (est., vector tiles) | ~20ms (per viewport) | Yes (tile-based) | No (HTTP Range) |
| **MVT (Martin)** | Binary (tiled) | N/A (dynamic) | ~10ms (per tile) | Yes (tile-based) | Yes (Martin) |

**Recommendation by layer:**

- **Bus stops (10,284 points, 3.4 MB):** GeoJSON is sufficient. The file loads in ~200ms and MapLibre's built-in geojson-vt tiles it client-side. No server needed. For a modest improvement, use FlatGeobuf (~1.4 MB) with spatial filtering.

- **Settlements (~5,257 points with attributes):** GeoJSON. Estimated ~2 MB with population, EKATTE code, and access score. Loads instantly.

- **Administrative boundaries (179 municipalities, 28 oblasts):** GeoJSON simplified with mapshaper to ~1 MB. These polygons are static and change infrequently.

- **H3 hexagons (~21,600 cells at resolution 7):** GeoJSON or Deck.gl's native H3 format (array of `{h3Index, value}` objects). H3 cell geometries are computed client-side from the index, so only the index + attributes need to be transmitted (~500 KB).

- **Future large datasets (routes, frequencies, census):** PMTiles or Martin-served MVT tiles for anything exceeding ~50 MB.

**Total initial payload:** ~7 MB GeoJSON (all layers). Acceptable for a dashboard application. No tile server needed for Phase 1.

### 2.4 ESRI ArcGIS Server Export / NAP Integration

Bulgaria's National Access Point (NAP) and institutional stakeholders may require data in ESRI-compatible formats. Three interoperability approaches:

#### Option A: OGC API Features (Recommended)

The modern successor to WFS. Provides RESTful JSON/GeoJSON endpoints that both ESRI ArcGIS Online and open-source tools consume natively.

- **Implementation:** Martin does not serve OGC API Features natively. Use `pygeoapi` (Python, v0.19.0) or `ldproxy` (Java) as a lightweight OGC API facade over the same PostGIS database.
- **ESRI compatibility:** ArcGIS Online supports adding OGC Feature layers directly. ArcGIS Pro can consume OGC API Features since v3.0.

```yaml
# pygeoapi configuration for PT stops
resources:
  pt-stops:
    type: collection
    title: "BDP Transport Stops"
    providers:
      - type: feature
        name: PostgreSQL
        data:
          host: localhost
          dbname: bdp
          user: reader
          search_path: [public]
        id_field: id
        table: stops_wgs84
        geom_field: geom
```

#### Option B: Static GeoJSON Export

Generate GeoJSON files per layer and publish them at stable URLs. ESRI ArcGIS Online can add GeoJSON as a layer directly.

- **Pros:** Simplest, no server process
- **Cons:** No filtering, no pagination, stale until regenerated

#### Option C: GeoServer WFS/WMS

Run GeoServer for full OGC compliance (WMS, WFS, WMTS). Heavyweight but maximally compatible with legacy ESRI and institutional GIS systems.

- **Pros:** Full WMS/WFS/WMTS, ESRI ArcGIS Server can federate
- **Cons:** Java process, significant resource overhead, operational complexity

**Recommendation:** Start with Option B (static GeoJSON) for Phase 1. Move to Option A (OGC API Features via pygeoapi) when NAP integration becomes a requirement. Avoid Option C unless mandated by institutional requirements.

---

## 3. Multi-Layer Visualization Architecture

### 3.1 Layer Stack Design

The dashboard renders layers in the following Z-order (bottom to top). Each layer can be toggled independently via the sidebar controls.

```
Layer 6 (future): Service corridors - routes, frequencies
Layer 5 (future): Heat map overlay - transport poverty intensity (KDE or H3)
Layer 4: Bus stop locations - from BDP data (10,284 points)
Layer 3: Proportional circles - settlement markers sized by population
Layer 2: Settlement markers - colored by PT access score
Layer 1: Administrative boundaries - NUTS, oblasts, municipalities
Layer 0: Base map - OSM vector tiles, muted style
```

Note: Layers 2 and 3 are visually merged - each settlement is a single circle that encodes both color (access score) and size (population). They are listed separately because the data sources may differ (EKATTE vs computed access).

### 3.2 GeoJSON Schema Definitions

#### Layer 0: Base Map

Not GeoJSON. PMTiles file served via HTTP Range Requests, styled with MapLibre Style Specification.

#### Layer 1: Administrative Boundaries

```typescript
interface AdminBoundaryFeature {
  type: 'Feature';
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: {
    level: 'oblast' | 'municipality';  // NUTS3 = oblast, LAU = municipality
    code: string;      // NUTS code (BG411) or EKATTE municipality code
    name_bg: string;   // Bulgarian name
    name_en: string;   // English transliteration
    parent_code: string | null;  // oblast code for municipalities, null for oblasts
    // Aggregated PT metrics (computed)
    total_settlements: number;
    settlements_with_pt: number;
    total_population: number;
    population_with_pt: number;
    pct_settlements_covered: number;  // 0-100
    pct_population_covered: number;   // 0-100
  };
}
```

**Source:** GADM v4.1 Bulgaria administrative boundaries (gadm.org), simplified to ~1 MB with mapshaper (`-simplify 10%`).

#### Layer 2+3: Settlement Markers (Combined)

```typescript
interface SettlementFeature {
  type: 'Feature';
  geometry: GeoJSON.Point;  // settlement centroid
  properties: {
    ekatte: string;          // EKATTE code (unique settlement ID)
    name_bg: string;         // Bulgarian name
    name_en: string;         // English transliteration
    type: 'grad' | 'selo';  // city or village
    oblast: string;          // parent oblast name
    municipality: string;    // parent municipality name
    population: number;      // from NSI census data
    // PT access metrics (computed)
    nearest_stop_m: number;       // distance to nearest bus stop in meters
    stops_within_1km: number;     // count of stops within 1 km
    stops_within_3km: number;     // count of stops within 3 km
    access_score: number;         // 0.0-1.0 composite score
    access_level: 'none' | 'poor' | 'partial' | 'good';  // categorical
  };
}
```

#### Layer 4: Bus Stops

```typescript
interface BusStopFeature {
  type: 'Feature';
  geometry: GeoJSON.Point;  // WGS84 coordinates
  properties: {
    id: number;              // BDP GIS Cloud __id
    oblast: string;
    municipality: string;
    city: string;            // city_vila from BDP
    road: string;            // road_n from BDP
    road_type: 'street' | 'road';  // ulitsa or pat
    // Inspection data (when available)
    inspected: boolean;
    has_bay: boolean | null;        // djob
    has_fencing: boolean | null;    // ogradni
    has_barriers: boolean | null;   // buferni_t
    has_lighting: boolean | null;   // osvetyavan
    has_signs: boolean | null;      // znaci
    inspection_date: string | null; // date1, ISO format
  };
}
```

#### Layer 5 (Future): Transport Poverty Heat Map

Two formats depending on technique:

**Option A - KDE:** No GeoJSON. MapLibre native `heatmap` layer type consuming the same bus stop GeoJSON source with weight property.

**Option B - H3 Hexagons:**
```typescript
interface H3HexagonData {
  h3Index: string;           // H3 resolution-7 index (e.g., "871f9a4a0ffffff")
  stop_count: number;        // bus stops within this hexagon
  population: number;        // estimated population within hexagon
  access_score: number;      // 0.0-1.0
  nearest_settlement: string; // EKATTE code of nearest settlement centroid
}
```

#### Layer 6 (Future): Service Corridors

```typescript
interface RouteFeature {
  type: 'Feature';
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  properties: {
    route_id: string;
    route_name: string;
    operator: string;
    type: 'urban' | 'intercity' | 'rail';
    frequency_daily: number;     // trips per day
    first_departure: string;     // HH:MM
    last_departure: string;      // HH:MM
    stops: string[];             // ordered list of stop IDs
  };
}
```

### 3.3 Dashboard Layout

```
+------------------------------------------------------------------+
|  Header: BDP Transport Accessibility Dashboard                    |
+------------------+-----------------------------------------------+
|                  |                                                 |
|  Sidebar         |  Map Panel                                      |
|  (320px fixed)   |  (remaining width)                              |
|                  |                                                 |
|  [Layer Toggle]  |  +-------------------------------------------+ |
|  [] Base map     |  |                                           | |
|  [] Boundaries   |  |     MapLibre GL JS                        | |
|  [] Settlements  |  |     Interactive Map                       | |
|  [] Bus Stops    |  |                                           | |
|  [] Heat Map     |  |     [Zoom +/-]  [Fullscreen]              | |
|                  |  |                                           | |
|  [Filter Panel]  |  +-------------------------------------------+ |
|  Oblast: [v]     |                                                 |
|  Municipality:[v]|  +-------------------------------------------+ |
|  Access Level:[v]|  |  Legend (collapsible)                     | |
|                  |  |  Red=No PT  Yellow=Partial  Green=Good    | |
|  [Stats Panel]   |  +-------------------------------------------+ |
|  Total: 5,257    |                                                 |
|  With PT: 3,100  |                                                 |
|  Without: 2,157  |                                                 |
|  Coverage: 59%   |                                                 |
|                  |                                                 |
|  [NUTS Agg Table]|                                                 |
|  Oblast | Settle |                                                 |
|  -------|--------|                                                 |
|  Sofia  | 89%    |                                                 |
|  Plovdiv| 72%    |                                                 |
|  ...    | ...    |                                                 |
|                  |                                                 |
+------------------+-----------------------------------------------+
```

### 3.4 Core Application Architecture

```typescript
// main.ts - Application entry point
import maplibregl from 'maplibre-gl';  // v5.22.0
import { Protocol } from 'pmtiles';     // v4.2.0

// Register PMTiles protocol for serverless vector tile loading
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const map = new maplibregl.Map({
  container: 'map',
  style: '/styles/bdp-dataviz.json',  // custom muted style
  center: [25.48, 42.73],             // Bulgaria center
  zoom: 7,
  minZoom: 6,
  maxZoom: 16,
  maxBounds: [[20.0, 40.5], [30.0, 44.8]]  // Bulgaria extent + padding
});

map.on('load', async () => {
  // Load data sources
  await Promise.all([
    loadAdminBoundaries(map),
    loadSettlements(map),
    loadBusStops(map)
  ]);

  // Initialize sidebar controls
  initLayerToggles(map);
  initFilterPanel(map);
  initStatsPanel(map);
});
```

```typescript
// layers/busStops.ts
export async function loadBusStops(map: maplibregl.Map): Promise<void> {
  const response = await fetch('/data/bdp_stops_wgs84.json');
  const stops: BusStopFeature[] = await response.json();

  // Convert to GeoJSON FeatureCollection
  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: stops.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        oblast: s.oblast,
        municipality: s.municipal,
        city: s.city,
        road: s.road,
        road_type: s.road_type
      }
    }))
  };

  map.addSource('bus-stops', {
    type: 'geojson',
    data: geojson,
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 50
  });

  // Clustered circles
  map.addLayer({
    id: 'bus-stops-clusters',
    type: 'circle',
    source: 'bus-stops',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        '#51bbd6', 10,
        '#f1f075', 50,
        '#f28cb1'
      ],
      'circle-radius': [
        'step', ['get', 'point_count'],
        15, 10,
        20, 50,
        25
      ]
    }
  });

  // Cluster count labels
  map.addLayer({
    id: 'bus-stops-cluster-count',
    type: 'symbol',
    source: 'bus-stops',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['Noto Sans Regular'],
      'text-size': 12
    }
  });

  // Individual stop points (unclustered)
  map.addLayer({
    id: 'bus-stops-unclustered',
    type: 'circle',
    source: 'bus-stops',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#2563eb',
      'circle-radius': 5,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Click handler for popups
  map.on('click', 'bus-stops-unclustered', (e) => {
    if (!e.features || e.features.length === 0) return;
    const props = e.features[0].properties;
    const coords = (e.features[0].geometry as GeoJSON.Point).coordinates;

    new maplibregl.Popup()
      .setLngLat(coords as [number, number])
      .setHTML(`
        <strong>${props.city || 'N/A'}</strong><br/>
        ${props.road || ''}<br/>
        ${props.oblast}, ${props.municipality}<br/>
        Type: ${props.road_type === 'street' ? 'Urban' : 'Intercity'}
      `)
      .addTo(map);
  });
}
```

```typescript
// layers/settlements.ts
export async function loadSettlements(map: maplibregl.Map): Promise<void> {
  const response = await fetch('/data/settlements.geojson');
  const data: GeoJSON.FeatureCollection = await response.json();

  map.addSource('settlements', {
    type: 'geojson',
    data
  });

  map.addLayer({
    id: 'settlements-circles',
    type: 'circle',
    source: 'settlements',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'],
        ['sqrt', ['get', 'population']],
        0, 3,
        10, 5,
        50, 10,
        100, 15,
        400, 30
      ],
      'circle-color': [
        'interpolate', ['linear'],
        ['get', 'access_score'],
        0, '#dc2626',
        0.3, '#f97316',
        0.6, '#eab308',
        1.0, '#16a34a'
      ],
      'circle-opacity': 0.8,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff'
    }
  });
}
```

```typescript
// layers/adminBoundaries.ts
export async function loadAdminBoundaries(map: maplibregl.Map): Promise<void> {
  const response = await fetch('/data/admin_boundaries.geojson');
  const data: GeoJSON.FeatureCollection = await response.json();

  map.addSource('admin-boundaries', {
    type: 'geojson',
    data
  });

  // Municipality fill (choropleth mode - toggled via sidebar)
  map.addLayer({
    id: 'municipality-fill',
    type: 'fill',
    source: 'admin-boundaries',
    filter: ['==', ['get', 'level'], 'municipality'],
    paint: {
      'fill-color': [
        'step',
        ['get', 'pct_population_covered'],
        '#a50f15',    // 0-20%
        20, '#de2d26',
        40, '#fb6a4a',
        60, '#fcae91',
        80, '#fee5d9'  // 80-100%
      ],
      'fill-opacity': 0.4
    },
    layout: { visibility: 'none' }  // hidden by default, toggled via sidebar
  });

  // Municipality outlines
  map.addLayer({
    id: 'municipality-outline',
    type: 'line',
    source: 'admin-boundaries',
    filter: ['==', ['get', 'level'], 'municipality'],
    paint: {
      'line-color': '#6b7280',
      'line-width': 1,
      'line-dasharray': [2, 2]
    }
  });

  // Oblast outlines (thicker)
  map.addLayer({
    id: 'oblast-outline',
    type: 'line',
    source: 'admin-boundaries',
    filter: ['==', ['get', 'level'], 'oblast'],
    paint: {
      'line-color': '#374151',
      'line-width': 2
    }
  });
}
```

### 3.5 Progressive Enrichment Architecture

The architecture is designed so new data layers can be added without modifying existing code. The pattern:

1. **Data contract:** Each layer defines a GeoJSON schema (Section 3.2). New layers add a new schema file, not modify existing ones.

2. **Layer registry:** A configuration-driven layer system where adding a layer requires only a JSON entry:

```typescript
// config/layers.ts
interface LayerConfig {
  id: string;
  label: string;
  source: {
    type: 'geojson' | 'pmtiles' | 'vector';
    url: string;
  };
  layers: maplibregl.LayerSpecification[];  // MapLibre style layers
  defaultVisible: boolean;
  group: 'base' | 'analysis' | 'data' | 'future';
}

const LAYER_REGISTRY: LayerConfig[] = [
  {
    id: 'bus-stops',
    label: 'Bus Stops (BDP)',
    source: { type: 'geojson', url: '/data/bdp_stops_wgs84.json' },
    layers: [/* ... circle + cluster layers */],
    defaultVisible: true,
    group: 'data'
  },
  {
    id: 'settlements',
    label: 'Settlements',
    source: { type: 'geojson', url: '/data/settlements.geojson' },
    layers: [/* ... proportional circle layers */],
    defaultVisible: true,
    group: 'analysis'
  },
  // Adding a new layer = adding an entry here
  // No existing code changes required
];
```

3. **Sidebar auto-generation:** The sidebar layer toggles and filter panels are generated from `LAYER_REGISTRY`. Adding a layer config entry automatically creates its UI toggle.

4. **Data pipeline independence:** Each layer's GeoJSON file is produced by an independent pipeline script. The pipeline for stops does not depend on the pipeline for settlements. New data sources plug into the same pattern:
   - Raw data -> processing script -> GeoJSON file -> layer config entry -> dashboard

### 3.6 ESRI ArcGIS Export Harness

A lightweight endpoint design for serving dashboard data to ESRI ArcGIS and other institutional GIS systems.

**Phase 1 - Static GeoJSON endpoints:**

```
GET /api/v1/layers/stops.geojson       -> Full bus stops GeoJSON
GET /api/v1/layers/settlements.geojson -> Full settlements GeoJSON
GET /api/v1/layers/boundaries.geojson  -> Admin boundaries GeoJSON
```

These are static files served by nginx or any web server. ArcGIS Online can consume them directly via "Add Layer from URL" -> "A GeoJSON file".

**Phase 2 - OGC API Features (when needed):**

```
GET /api/v1/ogc/collections                           -> List of available collections
GET /api/v1/ogc/collections/stops/items               -> Paginated GeoJSON features
GET /api/v1/ogc/collections/stops/items?oblast=Sofia   -> Filtered by attribute
GET /api/v1/ogc/collections/stops/items?bbox=23,42,24,43 -> Spatial filter
```

Implementation via pygeoapi (v0.19.0, Python) configured against the same PostGIS database used by Martin. Pygeoapi provides full OGC API Features compliance, including:
- JSON/GeoJSON output (default)
- HTML browsable interface
- OpenAPI 3.0 specification auto-generated
- CRS negotiation (EPSG:4326 default, EPSG:3857 available)

This is consumable by ArcGIS Online (native OGC Feature layers), QGIS, and any OGC-compliant client.

---

## 4. Recommended Technology Stack Summary

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| **Map renderer** | MapLibre GL JS | v5.22.0 | WebGL, native vector tiles, data-driven styling, active ecosystem |
| **Base map tiles** | Protomaps PMTiles (Bulgaria extract) | v4 format | Self-hosted, zero server cost, custom muted style |
| **Base map schema** | OpenMapTiles | v3.15 | Standard vector tile schema, broad style compatibility |
| **Data overlay format** | GeoJSON (Phase 1) | RFC 7946 | Simple, sufficient for ~15K points, no server needed |
| **Data overlay format** | FlatGeobuf (Phase 2) | v3.31 | 60% smaller, spatial filtering, HTTP Range Requests |
| **Tile server** | Martin | v1.5.0 | Fastest PostGIS tile server, PMTiles + MBTiles support |
| **Advanced viz (future)** | Deck.gl (via @deck.gl/maplibre) | v9.2 | H3 hexagons, GPU heat maps, million-point capacity |
| **H3 spatial index** | h3-js | v4.2.0 | Hexagonal binning for transport poverty analysis |
| **OGC API (future)** | pygeoapi | v0.19.0 | OGC API Features for ESRI/NAP interoperability |
| **Admin boundaries** | GADM + mapshaper | v4.1 | Bulgaria oblasts + municipalities, simplified |
| **Hosting** | Static files + CDN | N/A | Cloudflare R2 or S3 + CloudFront for PMTiles + GeoJSON |

### Performance Budget

| Metric | Target | Basis |
|--------|--------|-------|
| Initial map load (cold) | < 3 seconds | PMTiles base (~300 KB initial) + GeoJSON overlays (~7 MB) |
| Map interaction (pan/zoom) | 60 fps | WebGL rendering, ~15K points = single draw call |
| Layer toggle response | < 100ms | MapLibre `setLayoutProperty` visibility toggle |
| Filter update | < 200ms | MapLibre `setFilter` expression update |
| Largest GeoJSON file | < 5 MB | Settlements with all attributes |
| Total dashboard bundle (JS) | < 500 KB gzipped | MapLibre (~260 KB) + app code (~100 KB) + PMTiles protocol (~20 KB) |
