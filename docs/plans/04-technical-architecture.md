# Техническа архитектура (TAD): Национална бяла карта на ОТ

**Версия:** 1.0
**Дата:** 10 април 2026 г.
**Автор:** Михаил-Еренсто Михайлов

---

## 1. Преглед на архитектурата

### 1.1 Архитектурен стил

Фаза 1 е реализирана като **Static Site** -- без backend сървър. Всички данни са предварително обработени и сервирани като статични файлове (GeoJSON, PMTiles). Браузърът извършва цялата визуализация и филтрация чрез WebGL. Този подход елиминира оперативната сложност, минимизира разходите за хостинг и позволява разполагане на GitHub Pages, Cloudflare Pages или S3.

**Обосновка:** За 15 500 точки (5 256 населени места + 10 280 спирки) не е необходим сървър за обработка на заявки. MapLibre GL JS рендерира целия набор от данни client-side при 60fps чрез WebGL. Данните се обновяват периодично (не в реално време), което прави статичния подход напълно достатъчен.

### 1.2 Диаграма на компонентите

```
┌─────────────────────────────────────────────────────────────────────┐
│                          БРАУЗЪР (Client)                          │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │   MapLibre GL JS │  │   Sidebar UI     │  │   Stats Engine   │  │
│  │   v5.22.0        │  │   (Vanilla TS)   │  │   (Vanilla TS)   │  │
│  │                  │  │                  │  │                  │  │
│  │  - WebGL render  │  │  - Филтри        │  │  - Агрегации     │  │
│  │  - Layer mgmt    │◄─┤  - Layer toggles │  │  - NUTS2/област  │  │
│  │  - Popups        │  │  - Таблици       │──┤  - CSV износ     │  │
│  │  - Clustering    │  │  - Търсене       │  │                  │  │
│  └────────┬─────────┘  └──────────────────┘  └──────────────────┘  │
│           │                                                         │
│  ┌────────▼─────────┐                                              │
│  │  PMTiles Protocol│  (HTTP Range Requests за base map tiles)     │
│  └────────┬─────────┘                                              │
└───────────┼─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    СТАТИЧЕН ХОСТИНГ (Server)                       │
│                                                                     │
│  /tiles/bulgaria.pmtiles          ~400 MB  (Base map, OSM extract) │
│  /data/settlements.geojson        ~3.2 MB  (5 256 записа)         │
│  /data/stops.geojson              ~7.4 MB  (10 280 записа)        │
│  /data/oblasts.geojson            ~0.8 MB  (28 области, граници)  │
│  /styles/bdp-dataviz.json         ~15 KB   (MapLibre style)       │
│  /index.html + /dist/app.js       ~400 KB  (приложение, gzipped)  │
│                                                                     │
│  GitHub Pages / Cloudflare Pages / S3 + CloudFront                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Поток на данните (Data Flow)

```
                ОФЛАЙН (Build pipeline)                    ОНЛАЙН (Runtime)
                ─────────────────────                      ────────────────

 ek_atte.json ─────┐
 (НСИ, ЕКАТТЕ)     │
                    │   ┌─────────────────┐
 grao_pop.txt ──────┼──►│  Python build   │    settlements.geojson
 (ГРАО, население)  │   │  script         ├───────────────────────► Browser
                    │   │                 │    stops.geojson           │
 settlements_loc ───┤   │  merge +        ├───────────────────────► MapLibre
 (координати)       │   │  validate +     │    oblasts.geojson        │
                    │   │  generate       ├───────────────────────► WebGL
 bdp_stops.json ────┘   │  GeoJSON        │                      Rendering
 (БДП спирки)           └─────────────────┘                          │
                                                                     ▼
 bulgaria.osm.pbf ──► tilemaker ──► bulgaria.pmtiles ─────────► PMTiles
 (Geofabrik)                         (static file)            Protocol
```

---

## 2. Технологичен стек

### 2.1 MapLibre GL JS v5.22.0 (Map renderer)

**Избор:** MapLibre GL JS е основната библиотека за визуализация на картата.

**Защо MapLibre, а не алтернативите:**

| Критерий | Leaflet 1.9.4 | MapLibre GL JS v5.22.0 | Deck.gl v9.2 | Kepler.gl v3.3 |
|----------|---------------|------------------------|-------------|----------------|
| Rendering | DOM/Canvas | **WebGL** | WebGL2/WebGPU | WebGL (Deck.gl) |
| Vector tiles | Само чрез plugin | **Native, first-class** | Чрез MapLibre | Чрез MapLibre |
| Макс. точки (smooth) | ~10 000 | **~100 000+** | ~1 000 000+ | ~1 000 000+ |
| Data-driven styling | Ръчно, per-feature | **Expressions в style spec** | Accessor functions | GUI-driven |
| Мобилна поддръжка | Отлична | **Добра** (WebGL) | Ограничена | Слаба |
| Bundle size (gzip) | ~42 KB | **~260 KB** | ~350 KB | ~1.5 MB |
| Клъстеризация | Plugin | **Native** | Aggregation layers | Native |

**Ключови аргументи за MapLibre:**

1. **WebGL рендериране** -- 15 500 точки се рисуват като един draw call, 60fps без оптимизации
2. **Native vector tiles** -- PMTiles се зареждат директно, без tile server
3. **Data-driven styling** -- декларативни expressions за цвят и размер на маркерите по атрибути
4. **Built-in clustering** -- GeoJSON source с `cluster: true` автоматично групира точките при малък zoom
5. **Активна поддръжка** -- седмични releases, част от екосистемата MapLibre (Martin, Native, Style Spec)

**Leaflet** е отхвърлен поради липса на native WebGL и vector tiles. За 15 500 точки работи, но без запас за растеж. Plugin-ът markercluster (v1.5.3) не се поддържа от 2022 г.

**Deck.gl** е прекалено мощен за текущия обем данни (предназначен за милиони точки). Ще се използва селективно чрез `@deck.gl/maplibre` за H3 hexagons и GPU heat maps в бъдещи фази.

**Kepler.gl** е приложение, а не библиотека -- вграждането му носи целия UI, който е труден за персонализация. Полезен е за вътрешно изследване на данните, не за production dashboard.

> Подробна оценка: `research/visualization_tech.md`, Section 2.1

### 2.2 PMTiles / Protomaps v4 (Base map tiles)

**Подход:** Self-hosted Bulgaria OSM extract в PMTiles формат.

**PMTiles** е single-file архивен формат за vector tiles с вграден пространствен индекс. Браузърът извлича само необходимите tiles чрез HTTP Range Requests -- не е нужен tile server.

**Работен процес за генериране на базовата карта:**

```bash
# 1. Изтегляне на Bulgaria OSM extract
wget https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf

# 2. Генериране на vector tiles с tilemaker
tilemaker --input bulgaria-latest.osm.pbf \
          --output bulgaria.pmtiles \
          --config config.json \
          --process process.lua

# 3. Хостване на .pmtiles файла на статичен сървър
# Браузърът чете директно чрез HTTP Range Requests
```

**Защо self-hosted, а не hosted (MapTiler/Stadia):**

- **Нулева зависимост** от трета страна -- няма API ключове, няма rate limits
- **Нулева рекурентна цена** -- само разход за статичен хостинг (~$0.015/GB на Cloudflare R2)
- **Пълен контрол на стила** -- custom MapLibre style JSON с muted палитра за dataviz
- **Офлайн способност** -- PMTiles може да се зареди изцяло в браузъра

**Защо не стандартен OSM raster tile server (tile.openstreetmap.org):**
Фиксираният стил с ярки цветове се конкурира визуално с data overlays. Стилът не може да бъде персонализиран client-side. Usage policy ограничава до 250 000 tiles/ден.

> Подробна оценка: `research/visualization_tech.md`, Section 1.1

### 2.3 Vanilla TypeScript (без framework)

За Фаза 1 приложението се изгражда с **Vanilla TypeScript** без React, Vue или друг framework.

**Обосновка:**

- Приложението има един екран (карта + sidebar) без навигация или маршрутизация
- DOM манипулациите са ограничени до sidebar (филтри, таблици, статистики)
- MapLibre GL JS управлява цялата визуализация на картата
- Без framework: по-малък bundle, по-бързо зареждане, по-прост build
- При нужда от framework (Фаза 2+), миграцията е лесна -- MapLibre има official bindings за React, Vue, Svelte

**Build tooling:** Vite (за TypeScript compilation, HMR, production build)

### 2.4 Статичен хостинг

| Опция | Предимства | Ограничения |
|-------|-----------|-------------|
| **GitHub Pages** | Безплатно, интеграция с CI/CD | 100 MB лимит за repo, 100 GB/месец bandwidth |
| **Cloudflare Pages** | Безплатна CDN, HTTP Range Requests за PMTiles | 25 MB макс. размер на файл (проблем за PMTiles) |
| **Cloudflare R2 + Pages** | R2 за PMTiles (Range Requests), Pages за останалото | Минимална цена за R2 storage |
| **S3 + CloudFront** | Неограничен размер, Range Requests | Цена за bandwidth |

**Препоръка:** Cloudflare R2 за PMTiles файла (~400 MB) + Cloudflare Pages за HTML/JS/GeoJSON. Общата месечна цена при 100 потребителя/ден е под $1.

---

## 3. Слоеве на картата

### 3.1 Стек от слоеве (Z-order, отдолу нагоре)

```
Layer 6 (Фаза 2+): Маршрутни коридори - линии, честота         [reserved]
Layer 5 (Фаза 2+): Heat map overlay - транспортна бедност       [reserved]
Layer 4: Автобусни спирки (10 280 точки, клъстеризирани)        [toggle]
Layer 3: Пропорционални кръгове (по население)                   [toggle]
Layer 2: Маркери за населени места (по has_pt_access)           [default ON]
Layer 1b: Подсветка на общински граници (fill + line)           [auto, при филтър]
Layer 1a: Подсветка на областни граници (fill + line)           [auto, при филтър]
Layer 1: Административни граници (области, GeoJSON)             [default ON]
Layer 0: Базова карта (PMTiles, muted dataviz style)            [always ON]
```

### 3.2 Layer 0: Базова карта (PMTiles)

PMTiles файл с Bulgaria OSM extract, стилизиран с custom MapLibre Style JSON. Палитрата е умишлено приглушена, за да не се конкурира с data overlays:

| Елемент | Цвят | Обосновка |
|---------|------|-----------|
| Земя | `#f8f9fa` (near-white) | Максимален контраст за цветни маркери |
| Сгради | `#e9ecef` (light gray) | Видими за ориентация, не доминират |
| Вода | `#dbeafe` (pale blue) | Стандартна географска референция |
| Пътища (главни) | `#adb5bd` (medium gray) | Мрежов контекст без визуална конкуренция |
| Пътища (второстепенни) | `#dee2e6` (light gray) | Фонова текстура |
| Железопътни линии | `#6366f1` (indigo), dashed | Акцентирана ОТ инфраструктура |
| Надписи | `#6b7280`, 11px | Четими, но не доминиращи |

Това произвежда "dataviz" базова карта, аналогична на MapTiler Dataviz или CartoDB Positron.

### 3.3 Layer 1: Административни граници (области)

**Източник:** GADM v4.1, опростени с mapshaper (`-simplify 10%`) до ~0.8 MB.

**Визуализация:** Контурни линии на 28-те области. Municipalities (общини) се показват при zoom >= 10.

```typescript
// Контур на области - плътна линия
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

// Контур на общини - пунктир, при zoom >= 10
map.addLayer({
  id: 'municipality-outline',
  type: 'line',
  source: 'admin-boundaries',
  filter: ['==', ['get', 'level'], 'municipality'],
  paint: {
    'line-color': '#6b7280',
    'line-width': 1,
    'line-dasharray': [2, 2]
  },
  minzoom: 10
});
```

### 3.4 Layer 1a: Подсветка на областни граници

Допълнителен слой за визуално подчертаване на избрана област при филтриране. Скрит по подразбиране, показва се чрез `setFilter` при промяна на филтъра за област.

**Източник:** `oblasts_boundaries.geojson` (geoBoundaries ADM1, 28 features, ~399 KB).

**Стратегия за съпоставяне на имена:** При зареждане на GeoJSON се изгражда `Map<string, Feature>` (ключ: латинско име на областта), което позволява O(1) lookup при филтриране.

```typescript
// Fill слой -- полупрозрачен фон
map.addLayer({
  id: 'oblast-boundary-fill',
  type: 'fill',
  source: 'oblasts-boundaries',
  paint: {
    'fill-color': 'rgba(217,119,6,0.1)'
  },
  layout: { visibility: 'none' },
  filter: ['==', ['get', 'name'], '']  // скрит по подразбиране
}, 'settlements-markers');  // под маркерите

// Line слой -- контур
map.addLayer({
  id: 'oblast-boundary-line',
  type: 'line',
  source: 'oblasts-boundaries',
  paint: {
    'line-color': '#d97706',
    'line-width': 3
  },
  layout: { visibility: 'none' },
  filter: ['==', ['get', 'name'], '']
}, 'settlements-markers');
```

### 3.5 Layer 1b: Подсветка на общински граници

Аналогичен слой за подчертаване на избрана община. Активира се при промяна на филтъра за община. Използва пунктирана линия за разграничаване от областния контур.

**Източник:** `municipalities_boundaries.geojson` (geoBoundaries ADM2, 265 features, ~1.1 MB).

**Стратегия за съпоставяне на имена:** Както при областите -- `Map<string, Feature>` с латинско име като ключ, изградена при стартиране на приложението.

```typescript
// Fill слой -- полупрозрачен фон
map.addLayer({
  id: 'municipality-boundary-fill',
  type: 'fill',
  source: 'municipalities-boundaries',
  paint: {
    'fill-color': 'rgba(217,119,6,0.1)'
  },
  layout: { visibility: 'none' },
  filter: ['==', ['get', 'name'], '']
}, 'settlements-markers');

// Line слой -- пунктиран контур
map.addLayer({
  id: 'municipality-boundary-line',
  type: 'line',
  source: 'municipalities-boundaries',
  paint: {
    'line-color': '#d97706',
    'line-width': 3,
    'line-dasharray': [4, 3]
  },
  layout: { visibility: 'none' },
  filter: ['==', ['get', 'name'], '']
}, 'settlements-markers');
```

**Логика за подсветка (споделена между двата слоя):**

```typescript
// Lookup таблици, изградени при зареждане на GeoJSON
const oblastLookup = new Map<string, GeoJSON.Feature>();
const municipalityLookup = new Map<string, GeoJSON.Feature>();

function highlightBoundary(level: 'oblast' | 'municipality', name: string | null) {
  const layerPrefix = level === 'oblast' ? 'oblast-boundary' : 'municipality-boundary';
  const fillId = `${layerPrefix}-fill`;
  const lineId = `${layerPrefix}-line`;

  if (!name) {
    // Изчистване на подсветката
    map.setLayoutProperty(fillId, 'visibility', 'none');
    map.setLayoutProperty(lineId, 'visibility', 'none');
    return;
  }

  // Задаване на филтър за показване на съответния полигон
  const filter: maplibregl.FilterSpecification = ['==', ['get', 'name'], name];
  map.setFilter(fillId, filter);
  map.setFilter(lineId, filter);
  map.setLayoutProperty(fillId, 'visibility', 'visible');
  map.setLayoutProperty(lineId, 'visibility', 'visible');

  // fitBounds към bbox на полигона
  const lookup = level === 'oblast' ? oblastLookup : municipalityLookup;
  const feature = lookup.get(name);
  if (feature) {
    const bbox = turf.bbox(feature) as [number, number, number, number];
    map.fitBounds(bbox, { padding: 40, duration: 600 });
  }
}
```

### 3.6 Layer 2: Маркери за населени места (data-driven styling по `has_pt_access`)

Всяко от 5 256-те населени места се визуализира като circle с цвят, определен от `has_pt_access`:

- **Зелено** (`#16a34a`): населено място с поне 1 спирка
- **Червено** (`#dc2626`): населено място без спирка

```typescript
map.addLayer({
  id: 'settlements-markers',
  type: 'circle',
  source: 'settlements',
  paint: {
    'circle-radius': [
      'interpolate', ['linear'], ['zoom'],
      7, 3,    // национален мащаб - малки точки
      10, 5,   // областен мащаб
      14, 8    // общински мащаб
    ],
    'circle-color': [
      'case',
      ['get', 'has_pt_access'],
      '#16a34a',   // зелено - с ОТ
      '#dc2626'    // червено - без ОТ
    ],
    'circle-opacity': 0.85,
    'circle-stroke-width': 1,
    'circle-stroke-color': '#ffffff'
  }
});
```

### 3.7 Layer 3: Пропорционални кръгове (по население)

Отделен toggle слой, който визуализира населението с пропорционални кръгове (sqrt scaling):

```typescript
map.addLayer({
  id: 'settlements-proportional',
  type: 'circle',
  source: 'settlements',
  paint: {
    'circle-radius': [
      'interpolate', ['linear'],
      ['sqrt', ['coalesce', ['get', 'population_permanent'], 0]],
      0, 3,       // население 0 -> 3px
      10, 5,      // население 100 -> 5px
      50, 10,     // население 2 500 -> 10px
      100, 15,    // население 10 000 -> 15px
      400, 30     // население 160 000 -> 30px (София)
    ],
    'circle-color': [
      'case',
      ['get', 'has_pt_access'],
      '#16a34a',
      '#dc2626'
    ],
    'circle-opacity': 0.6,
    'circle-stroke-width': 1,
    'circle-stroke-color': '#ffffff'
  },
  layout: { visibility: 'none' }  // скрит по подразбиране
});
```

### 3.8 Layer 4: Автобусни спирки (клъстеризирани)

10 280 БДП спирки с built-in MapLibre clustering:

```typescript
map.addSource('bus-stops', {
  type: 'geojson',
  data: '/data/stops.geojson',
  cluster: true,
  clusterMaxZoom: 12,
  clusterRadius: 50
});

// Клъстерирани кръгове
map.addLayer({
  id: 'stops-clusters',
  type: 'circle',
  source: 'bus-stops',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': [
      'step', ['get', 'point_count'],
      '#51bbd6', 10,    // < 10 спирки
      '#f1f075', 50,    // 10-50 спирки
      '#f28cb1'         // > 50 спирки
    ],
    'circle-radius': [
      'step', ['get', 'point_count'],
      15, 10,
      20, 50,
      25
    ]
  }
});

// Етикети на клъстерите
map.addLayer({
  id: 'stops-cluster-count',
  type: 'symbol',
  source: 'bus-stops',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-font': ['Noto Sans Regular'],
    'text-size': 12
  }
});

// Индивидуални спирки (неклъстеризирани)
map.addLayer({
  id: 'stops-unclustered',
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
```

### 3.9 Layers 5-6: Запазени за Фаза 2+

- **Layer 5: Heat map** -- KDE визуализация на плътността на обслужване чрез MapLibre native `heatmap` layer type или H3 hexagons чрез Deck.gl `H3HexagonLayer`
- **Layer 6: Маршрутни коридори** -- LineString/MultiLineString слоеве за автобусни маршрути с честота на обслужване

### 3.10 Layer Registry Pattern

Системата от слоеве е управлявана чрез конфигурационен регистър, който позволява добавяне на нови слоеве без промяна на код:

```typescript
// config/layers.ts
interface LayerConfig {
  id: string;
  label: string;           // Показван в sidebar
  source: {
    type: 'geojson' | 'pmtiles' | 'vector';
    url: string;
  };
  layers: maplibregl.LayerSpecification[];  // MapLibre style layers
  defaultVisible: boolean;
  group: 'base' | 'data' | 'analysis' | 'future';
  lazyLoad?: boolean;      // зареждане при поискване
}

const LAYER_REGISTRY: LayerConfig[] = [
  {
    id: 'settlements',
    label: 'Населени места',
    source: { type: 'geojson', url: '/data/settlements.geojson' },
    layers: [/* settlements-markers, settlements-proportional */],
    defaultVisible: true,
    group: 'data'
  },
  {
    id: 'bus-stops',
    label: 'БДП спирки',
    source: { type: 'geojson', url: '/data/stops.geojson' },
    layers: [/* stops-clusters, stops-cluster-count, stops-unclustered */],
    defaultVisible: false,
    group: 'data',
    lazyLoad: true        // зарежда се при първо включване
  },
  {
    id: 'admin-boundaries',
    label: 'Административни граници',
    source: { type: 'geojson', url: '/data/oblasts.geojson' },
    layers: [/* oblast-outline, municipality-outline */],
    defaultVisible: true,
    group: 'base'
  }
  {
    id: 'oblasts-boundaries',
    label: 'Подсветка на област',
    source: { type: 'geojson', url: '/data/oblasts_boundaries.geojson' },
    layers: [/* oblast-boundary-fill, oblast-boundary-line */],
    defaultVisible: false,
    group: 'base'
  },
  {
    id: 'municipalities-boundaries',
    label: 'Подсветка на община',
    source: { type: 'geojson', url: '/data/municipalities_boundaries.geojson' },
    layers: [/* municipality-boundary-fill, municipality-boundary-line */],
    defaultVisible: false,
    group: 'base'
  }
  // Добавяне на нов слой = нов запис тук
  // Не се изисква промяна на съществуващ код
];
```

Sidebar toggle-ите и филтрите се генерират автоматично от `LAYER_REGISTRY`.

---

## 4. Данни и формати

### 4.1 Входни данни

| Файл | Записи | Размер | Източник | Формат |
|------|--------|--------|----------|--------|
| `bg_settlements_with_pt.json` | 5 256 | ~3.2 MB | ЕКАТТЕ + ГРАО + yurukov + БДП | JSON array |
| `bdp_stops_wgs84.json` | 10 280 | ~7.4 MB (като GeoJSON) | БДП GIS Cloud | JSON array |
| `ek_obl.json` | 29 | ~5 KB | НСИ ЕКАТТЕ | JSON array |
| `ek_obst.json` | 266 | ~20 KB | НСИ ЕКАТТЕ | JSON array |

### 4.2 Генерирани слоеве (output на build script)

| Файл | Описание | Формат | Разм. |
|------|----------|--------|-------|
| `settlements.geojson` | FeatureCollection, Point, 5 256 features | GeoJSON RFC 7946 | ~3.2 MB |
| `stops.geojson` | FeatureCollection, Point, 10 280 features | GeoJSON RFC 7946 | ~3.5 MB |
| `oblasts.geojson` | FeatureCollection, Polygon/MultiPolygon, 28 features | GeoJSON RFC 7946 | ~0.8 MB |
| `oblasts_boundaries.geojson` | FeatureCollection, Polygon/MultiPolygon, 28 features -- контури за подсветка при филтриране | GeoJSON RFC 7946 | ~399 KB |
| `municipalities_boundaries.geojson` | FeatureCollection, Polygon/MultiPolygon, 265 features -- контури за подсветка при филтриране | GeoJSON RFC 7946 | ~1.1 MB |

**Външни източници за граници:**

| Файл | Източник | Ниво |
|------|----------|------|
| `oblasts_boundaries.geojson` | geoBoundaries ADM1 (www.geoboundaries.org) | Области (28) |
| `municipalities_boundaries.geojson` | geoBoundaries ADM2 (www.geoboundaries.org) | Общини (265) |

### 4.3 GeoJSON Schema: Населено място

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [23.93, 41.54] },
  "properties": {
    "ekatte": "00014",
    "name": "Абланица",
    "name_en": "Ablanitsa",
    "type": "с.",
    "oblast_code": "BLG",
    "oblast": "Благоевград",
    "obshtina_code": "BLG52",
    "obshtina": "Хаджидимово",
    "nuts2": "BG41",
    "nuts3": "BG413",
    "population_permanent": 2777,
    "population_current": 2650,
    "has_pt_access": true,
    "bdp_stop_count": 3
  }
}
```

### 4.4 GeoJSON Schema: Автобусна спирка

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [23.45, 42.69] },
  "properties": {
    "id": 12345,
    "oblast": "София",
    "municipal": "Столична",
    "city": "София",
    "road": "бул. Витоша",
    "road_type": "улица",
    "settlement_ekatte": "68134"
  }
}
```

### 4.5 Общ payload и производителност на зареждане

| Компонент | Размер | Зареждане |
|-----------|--------|-----------|
| PMTiles base map (initial viewport) | ~300 KB | ~200 ms |
| settlements.geojson | ~3.2 MB | ~150 ms parse |
| stops.geojson (lazy) | ~3.5 MB | ~200 ms parse |
| oblasts.geojson | ~0.8 MB | ~50 ms parse |
| oblasts_boundaries.geojson | ~399 KB | ~30 ms parse |
| municipalities_boundaries.geojson | ~1.1 MB | ~60 ms parse |
| App bundle (JS + CSS) | ~400 KB gzip | ~100 ms |
| **Общо (без stops)** | **~6.2 MB** | **< 2.5 сек** |
| **Общо (всички слоеве)** | **~9.7 MB** | **< 3.5 сек** |

Слоят с автобусни спирки е маркиран като `lazyLoad: true` и се зарежда при първо включване от потребителя, което намалява initial payload до ~6.2 MB.

### 4.6 Бъдещи формати за по-големи набори

- **FlatGeobuf** -- 60% по-малък от GeoJSON, поддържа spatial filtering чрез HTTP Range Requests. Подходящ за Phase 2 с маршрутни данни (>50 MB).
- **PMTiles (за data overlays)** -- за datasets над 100 MB, vector tiles с вградена пространствена индексация.

> Подробна оценка на форматите: `research/visualization_tech.md`, Section 2.3

---

## 5. Build Pipeline

### 5.1 Архитектура на pipeline

```
┌───────────────────────────────────────────────────────┐
│                  DATA PROCESSING (Python)              │
│                                                        │
│  scripts/build_data.py                                │
│    1. Зарежда ek_atte.json (5 256 ЕКАТТЕ)            │
│    2. Зарежда grao_population_parsed.json             │
│    3. Зарежда settlements_loc.csv (координати)        │
│    4. Зарежда bdp_stops_wgs84.json (10 280 спирки)   │
│    5. Изпълнява matching алгоритъм (текст + spatial)  │
│    6. Генерира settlements.geojson                    │
│    7. Генерира stops.geojson                          │
│    8. Генерира oblasts.geojson (от GADM + агрегации)  │
│    9. Генерира metadata.json (дата, брой, версия)     │
└───────────────────┬───────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────┐
│                  STATIC SITE BUILD (Vite)              │
│                                                        │
│  1. TypeScript compilation (src/ -> dist/)             │
│  2. CSS bundling                                       │
│  3. Asset copying (GeoJSON, PMTiles)                  │
│  4. HTML generation                                    │
└───────────────────┬───────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────┐
│                  DEPLOYMENT                            │
│                                                        │
│  GitHub Actions / manual:                              │
│    - Push dist/ to Cloudflare Pages                    │
│    - Upload PMTiles to Cloudflare R2                   │
└───────────────────────────────────────────────────────┘
```

### 5.2 Data processing script

Python скриптът `scripts/build_data.py` е отговорен за:

1. **Обединяване на източници** -- ЕКАТТЕ + ГРАО население + координати от yurukov
2. **Matching на спирки** -- двустепенен алгоритъм (административно текстово + spatial fallback при 5 km радиус) с 99.8% успеваемост (виж `research/bg_implementation.md`, Section 3)
3. **Генериране на GeoJSON** -- RFC 7946 compliant FeatureCollections
4. **Агрегации** -- NUTS2, област, община покритие, вградени в properties на oblasts.geojson
5. **Валидация** -- проверка за 5 256 записа, 4 без координати, 194 обезлюдени

### 5.3 Static site build

```bash
# Пълен build
npm run build:data    # Python: generate GeoJSON from raw sources
npm run build:app     # Vite: TypeScript -> JS bundle
npm run build:tiles   # tilemaker: OSM PBF -> PMTiles (рядко, при update на OSM)
```

---

## 6. NAP/ESRI интеграция

### 6.1 Фаза 1: Статични GeoJSON endpoints

Найпростият подход за интеграция с Националната точка за достъп (NAP) и институционални GIS системи:

```
GET /data/settlements.geojson    -- всички 5 256 населени места с ОТ статус
GET /data/stops.geojson          -- всички 10 280 БДП спирки
GET /data/oblasts.geojson        -- 28 области с агрегирани метрики
```

Това са статични файлове, обслужвани от CDN. ESRI ArcGIS Online може да ги консумира директно чрез "Add Layer from URL" -> "A GeoJSON file".

**Предимства:** Нулева инфраструктура, нулева поддръжка.
**Ограничения:** Без филтриране, без пагинация, данните се обновяват само при нов build.

### 6.2 Фаза 2: OGC API Features чрез pygeoapi

При нужда от динамични заявки за NAP интеграция, добавяне на pygeoapi (v0.19.0, Python) като лек OGC API facade:

```
GET /ogc/collections                                    -- списък на колекции
GET /ogc/collections/settlements/items                  -- пагиниран GeoJSON
GET /ogc/collections/settlements/items?oblast=Sofia     -- филтър по атрибут
GET /ogc/collections/settlements/items?bbox=23,42,24,43 -- пространствен филтър
```

```yaml
# pygeoapi configuration
resources:
  settlements:
    type: collection
    title: "BG Settlements PT Access"
    providers:
      - type: feature
        name: PostgreSQL
        data:
          host: localhost
          dbname: bdp
          search_path: [public]
        id_field: ekatte
        table: settlements
        geom_field: geom

  pt-stops:
    type: collection
    title: "BDP Transport Stops"
    providers:
      - type: feature
        name: PostgreSQL
        data:
          host: localhost
          dbname: bdp
        id_field: id
        table: stops_wgs84
        geom_field: geom
```

**ESRI съвместимост:**
- ArcGIS Online поддържа OGC Feature layers директно (native)
- ArcGIS Pro консумира OGC API Features от v3.0
- QGIS и всеки OGC-compliant клиент работят без допълнителна конфигурация

### 6.3 WFS съвместимост за ESRI ArcGIS Server

Ако институционални изисквания налагат WMS/WFS протоколи, може да се добави GeoServer (v2.28.0, Java). Това е тежко решение (Java servlet container) и се препоръчва само ако OGC API Features не е достатъчен за NAP.

> Подробна оценка на NAP/ESRI опциите: `research/visualization_tech.md`, Section 2.4

---

## 7. Производителност

### 7.1 WebGL rendering

MapLibre GL JS рендерира всички точки чрез WebGL pipeline:

| Метрика | Цел | Основание |
|---------|-----|-----------|
| Initial map load (cold) | < 3 сек | PMTiles base (~300 KB initial) + settlements.geojson (~3.2 MB) |
| Map interaction (pan/zoom) | 60 fps | WebGL, ~15 500 точки = единичен draw call |
| Layer toggle | < 100 ms | MapLibre `setLayoutProperty` visibility toggle |
| Filter update | < 200 ms | MapLibre `setFilter` expression update |
| JS bundle (gzipped) | < 500 KB | MapLibre (~260 KB) + app (~100 KB) + PMTiles protocol (~20 KB) |

### 7.2 Клъстеризация при малък zoom

При zoom levels 6-12, автобусните спирки (10 280 точки) се клъстеризират автоматично чрез MapLibre built-in clustering (`clusterRadius: 50`, `clusterMaxZoom: 12`). Това намалява броя на рендерираните обекти от ~10 000 на ~200-500 клъстера.

Населените места (5 256 точки) не се клъстеризират -- при fitBounds (национален мащаб) (национален мащаб) те са достатъчно малки (3px radius) за да се рендерират без проблем.

### 7.3 Lazy loading на слоя с автобусни спирки

Слоят `bus-stops` е маркиран с `lazyLoad: true` в Layer Registry. GeoJSON файлът (~3.5 MB) се изтегля едва когато потребителят включи слоя за пръв път. Това намалява initial payload с ~40%.

```typescript
async function toggleLayer(layerId: string, visible: boolean): Promise<void> {
  const config = LAYER_REGISTRY.find(l => l.id === layerId);
  if (!config) return;

  // Lazy load: зарежда данните при първо включване
  if (visible && config.lazyLoad && !map.getSource(layerId)) {
    const response = await fetch(config.source.url);
    const data = await response.json();
    map.addSource(layerId, { type: 'geojson', data, cluster: true, clusterMaxZoom: 12, clusterRadius: 50 });
    for (const layer of config.layers) {
      map.addLayer(layer);
    }
  }

  // Toggle visibility
  for (const layer of config.layers) {
    map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
  }
}
```

---

## 8. Разширяемост

### 8.1 Добавяне на нови data layers без промяна на код

Layer Registry pattern (Section 3.8) позволява добавянето на нов слой да се извършва чрез единствена JSON конфигурация:

1. Подготви GeoJSON файл (чрез Python build script)
2. Добави запис в `LAYER_REGISTRY`
3. Sidebar toggle се генерира автоматично

**Пример: добавяне на слой "Автогари" (Фаза 2):**

```typescript
// Добавяне само на конфигурация -- без промяна на съществуващ код
{
  id: 'bus-stations',
  label: 'Автогари (БДП)',
  source: { type: 'geojson', url: '/data/bus_stations.geojson' },
  layers: [{
    id: 'bus-stations-points',
    type: 'circle',
    source: 'bus-stations',
    paint: {
      'circle-color': '#7c3aed',
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  }],
  defaultVisible: false,
  group: 'data',
  lazyLoad: true
}
```

### 8.2 Добавяне на нови филтри (configuration-driven)

Филтрите в sidebar се генерират от конфигурация:

```typescript
interface FilterConfig {
  id: string;
  label: string;
  type: 'select' | 'checkbox' | 'range';
  property: string;              // GeoJSON property name
  options?: { value: string; label: string }[];
  appliesTo: string[];           // layer IDs
}

const FILTER_REGISTRY: FilterConfig[] = [
  {
    id: 'oblast-filter',
    label: 'Област',
    type: 'select',
    property: 'oblast',
    options: [], // автоматично от данните
    appliesTo: ['settlements', 'bus-stops']
  },
  {
    id: 'pt-status-filter',
    label: 'ОТ достъп',
    type: 'checkbox',
    property: 'has_pt_access',
    appliesTo: ['settlements']
  },
  {
    id: 'type-filter',
    label: 'Тип населено място',
    type: 'select',
    property: 'type',
    options: [
      { value: 'гр.', label: 'Градове' },
      { value: 'с.', label: 'Села' }
    ],
    appliesTo: ['settlements']
  }
];
```

Добавянето на нов филтър изисква само нов запис в `FILTER_REGISTRY`.

### 8.3 Schema evolution (nullable extension fields)

Моделът на данните е проектиран за разширяване без промяна на съществуващите полета:

```typescript
// Фаза 1 полета (неизменни)
interface SettlementPhase1 {
  ekatte: string;
  name: string;
  has_pt_access: boolean;
  bdp_stop_count: number;
  population_permanent: number;
  // ...
}

// Фаза 2+ полета (nullable, добавят се без промяна на Phase 1)
interface SettlementExtended extends SettlementPhase1 {
  ov_gk_class?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';  // Фаза 2
  route_count?: number;            // Фаза 2
  service_frequency?: number;      // Фаза 2
  connectivity_score?: number;     // Фаза 3
  transport_poverty_index?: number; // Фаза 4
}
```

Всички extension полета са `nullable` (`?` в TypeScript, `null` в JSON). Съществуващият код продължава да работи без промяна, защото не зависи от тези полета. Новите слоеве и филтри ги консумират чрез Layer Registry и Filter Registry.

---

## Приложение A: Пълен пример за MapLibre инициализация

```typescript
// src/main.ts
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';

// Регистриране на PMTiles протокол за serverless vector tile зареждане
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Инициализация на картата
const map = new maplibregl.Map({
  container: 'map',
  style: '/styles/bdp-dataviz.json',   // custom muted MapLibre style
  center: [25.48, 42.73],              // център на България
  zoom: 7,                              // национален мащаб
  minZoom: 4,
  maxZoom: 16,
  attributionControl: true
});

// Навигационни контроли
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

map.on('load', async () => {
  // Паралелно зареждане на данните
  const [settlementsRes, boundariesRes] = await Promise.all([
    fetch('/data/settlements.geojson'),
    fetch('/data/oblasts.geojson')
  ]);

  const settlements = await settlementsRes.json();
  const boundaries = await boundariesRes.json();

  // Добавяне на източници
  map.addSource('settlements', { type: 'geojson', data: settlements });
  map.addSource('admin-boundaries', { type: 'geojson', data: boundaries });

  // Добавяне на слоеве (Z-order)
  addAdminBoundaryLayers(map);
  addSettlementLayers(map);

  // Инициализация на sidebar
  initSidebar(map, settlements);
});
```

## Приложение Б: Sidebar interaction

```typescript
// src/sidebar.ts

function initSidebar(
  map: maplibregl.Map,
  settlements: GeoJSON.FeatureCollection
): void {
  const oblastSelect = document.getElementById('oblast-filter') as HTMLSelectElement;
  const ptStatusFilter = document.getElementById('pt-status-filter') as HTMLSelectElement;
  const statsPanel = document.getElementById('stats-panel')!;

  // Попълване на dropdown с области
  const oblasts = [...new Set(
    settlements.features.map(f => f.properties!.oblast as string)
  )].sort();

  oblasts.forEach(oblast => {
    const option = document.createElement('option');
    option.value = oblast;
    option.textContent = oblast;
    oblastSelect.appendChild(option);
  });

  // Обработка на филтриране
  function applyFilters(): void {
    const selectedOblast = oblastSelect.value;
    const selectedStatus = ptStatusFilter.value;

    // Изграждане на MapLibre filter expression
    const filters: any[] = ['all'];

    if (selectedOblast !== 'all') {
      filters.push(['==', ['get', 'oblast'], selectedOblast]);
    }

    if (selectedStatus === 'with_pt') {
      filters.push(['==', ['get', 'has_pt_access'], true]);
    } else if (selectedStatus === 'without_pt') {
      filters.push(['==', ['get', 'has_pt_access'], false]);
    }

    // Прилагане на филтър към слоя
    map.setFilter('settlements-markers', filters.length > 1 ? filters : null);

    // Обновяване на статистиките
    updateStats(settlements, selectedOblast, selectedStatus, statsPanel);
  }

  oblastSelect.addEventListener('change', applyFilters);
  ptStatusFilter.addEventListener('change', applyFilters);

  // Начално изчисление на статистиките
  updateStats(settlements, 'all', 'all', statsPanel);
}

function updateStats(
  settlements: GeoJSON.FeatureCollection,
  oblast: string,
  ptStatus: string,
  panel: HTMLElement
): void {
  let filtered = settlements.features;

  if (oblast !== 'all') {
    filtered = filtered.filter(f => f.properties!.oblast === oblast);
  }

  const total = filtered.length;
  const withPT = filtered.filter(f => f.properties!.has_pt_access).length;
  const withoutPT = total - withPT;
  const popTotal = filtered.reduce((s, f) => s + (f.properties!.population_permanent || 0), 0);
  const popWithPT = filtered
    .filter(f => f.properties!.has_pt_access)
    .reduce((s, f) => s + (f.properties!.population_permanent || 0), 0);

  panel.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Общо населени места:</span>
      <span class="stat-value">${total.toLocaleString('bg-BG')}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">С достъп до ОТ:</span>
      <span class="stat-value text-green">${withPT.toLocaleString('bg-BG')} (${((withPT/total)*100).toFixed(1)}%)</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Без достъп до ОТ:</span>
      <span class="stat-value text-red">${withoutPT.toLocaleString('bg-BG')} (${((withoutPT/total)*100).toFixed(1)}%)</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Население с ОТ:</span>
      <span class="stat-value">${popWithPT.toLocaleString('bg-BG')} (${((popWithPT/popTotal)*100).toFixed(1)}%)</span>
    </div>
  `;
}
```

---

*Следващ документ: 05-deployment-and-operations.md*
