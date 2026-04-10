# Спецификация за интеграция с NAP: Национална бяла карта на ОТ

**Версия:** 1.0
**Дата:** 10 април 2026 г.
**Автор:** Михаил-Еренсто Михайлов

---

## Съдържание

1. [Нормативна основа](#1-нормативна-основа)
2. [Архитектура на интеграцията](#2-архитектура-на-интеграцията)
3. [API спецификация (Phase 1)](#3-api-спецификация-phase-1)
4. [GeoJSON Schema definitions](#4-geojson-schema-definitions)
5. [ESRI ArcGIS Server съвместимост](#5-esri-arcgis-server-съвместимост)
6. [Обновяване на данните](#6-обновяване-на-данните)
7. [Съответствие с Делегиран регламент 2017/1926](#7-съответствие-с-делегиран-регламент-20171926)

---

## 1. Нормативна основа

### 1.1 Делегиран регламент (ЕС) 2017/1926

Делегиран регламент (ЕС) 2017/1926 от 31 май 2017 г. допълва Директива 2010/40/ЕС относно предоставянето на общоевропейски мултимодални информационни услуги за пътувания. Регламентът задължава всяка държава членка да създаде Национална точка за достъп (NAP) -- единна точка за достъп до статични и динамични данни за пътуване и трафик от различни видове транспорт.

**Категории данни по Приложение (чл. 3 и 4):**

| Категория | Примери | Краен срок |
|-----------|---------|------------|
| Статични данни за пътуване | Местоположение на спирки, маршрути, разписания, тарифи | 1.12.2019 |
| Динамични данни за пътуване | Закъснения, реално време на пристигане/заминаване | 1.12.2020 |
| Данни за свързани услуги | Информация за достъпност, паркинг, споделена мобилност | 1.12.2021 |

Делегиран регламент (ЕС) 2024/490 от 29 ноември 2023 г. изменя Регламент 2017/1926 с актуализирани изисквания за данните, включително разширени категории за мултимодална информация.

NAP може да бъде организирана като база данни, хранилище за данни, уеб портал или подобна платформа.

### 1.2 ЗОТ чл. 13 -- Национална точка за достъп

Законът за обществения транспорт (ДВ, бр. 32 от 1 април 2026 г.) урежда Националната точка за достъп в чл. 13, като я определя като елемент от ИСУТ. В България NAP се управлява от ИА "Автомобилна администрация". Бялата карта допринася към NAP с геопространствени данни за покритието на населените места с ОТ -- информация, допълваща данните за маршрути и разписания.

### 1.3 ЗОТ чл. 13, ал. 7 -- Мандатирана наредба

Чл. 13, ал. 7 от ЗОТ предвижда наредба на МТС, уреждаща условията за функциониране на NAP, формати за обмен на данни, оперативна съвместимост на билетни системи и функциониране на ИСУТ. Наредбата трябва да бъде приета в 4-месечен срок от влизането в сила на ЗОТ (ориентировъчно август 2026 г.). Тя ще определи конкретните формати за обмен, което прави настоящата спецификация проектна -- крайните формати ще бъдат съобразени с наредбата.

### 1.4 Контекст на napcore.eu

NAPCORE (National Access Point Coordination Organisation for Europe) координира NAP на държавите членки в ЕС (CEF финансиране). Настоящата спецификация следва принципите на NAPCORE: стандартни формати (GeoJSON RFC 7946, OGC API Features), метаданни за произход и актуалност, стабилни URL-и за машинен достъп и EPSG:4326 (WGS84) като CRS.

---

## 2. Архитектура на интеграцията

Интеграцията с NAP е разделена на три фази с нарастваща сложност. Фаза 1 е достатъчна за началния етап и не изисква допълнителна инфраструктура.

### 2.1 Phase 1: Static GeoJSON endpoints (незабавна)

Статични GeoJSON файлове, обслужвани от CDN (Cloudflare Pages / GitHub Pages). Файловете са продукт на build pipeline и се обновяват при всяко преизграждане на данните.

```
Static Hosting (CDN)
├── /data/settlements.geojson     5 256 features, ~3.2 MB
├── /data/stops.geojson           10 280 features, ~3.5 MB
├── /data/coverage/nuts2.json     6 записа (NUTS2 региони)
├── /data/coverage/oblast.json    28 записа (области)
└── /data/metadata.json           мета-информация за актуалност
```

**Предимства:** Нулева инфраструктура, нулева оперативна поддръжка, CDN кеширане.
**Ограничения:** Без филтриране от страна на сървъра, без пагинация. Клиентът получава пълния набор от данни.

### 2.2 Phase 2: OGC API Features via pygeoapi

При нужда от динамични заявки (филтриране по област, пространствен bbox филтър, пагинация), добавяне на pygeoapi (v0.19.0, Python) като лек OGC API Features facade:

```
pygeoapi (OGC API Features)
├── /ogc/collections                               -- списък колекции
├── /ogc/collections/settlements/items             -- пагиниран GeoJSON
├── /ogc/collections/settlements/items?oblast=Sofia -- филтър по атрибут
└── /ogc/collections/settlements/items?bbox=...    -- пространствен филтър
```

pygeoapi може да работи срещу статични GeoJSON файлове (GeoJSON provider) или PostGIS база данни. ESRI ArcGIS Online поддържа OGC Feature layers директно от v3.0.

### 2.3 Phase 3: Full WFS for ESRI ArcGIS Server

Само ако институционални изисквания налагат WMS/WFS протоколи. Изисква GeoServer (v2.28.0, Java servlet container) -- тежко решение, препоръчително единствено при изричен мандат от наредбата по чл. 13, ал. 7.

```
GeoServer (OGC WFS/WMS/WMTS)
├── WFS GetCapabilities
├── WFS GetFeature (GML/GeoJSON)
├── WMS GetMap (PNG/JPEG)
└── WMTS tile endpoints
```

**Препоръка:** Започване с Phase 1. Преминаване към Phase 2 при конкретно изискване от NAP. Phase 3 само при изричен мандат за WFS/WMS.

---

## 3. API спецификация (Phase 1)

Base URL: `https://{domain}/data/`

All endpoints serve pre-built static files. No query parameters are supported in Phase 1. Responses are valid GeoJSON (RFC 7946) or JSON.

### 3.1 GET /data/settlements.geojson

Full settlement dataset with PT coverage status.

**Response:** `200 OK`, `Content-Type: application/geo+json`

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"FeatureCollection"` |
| `features` | array | 5 256 Feature objects |
| `features[].type` | string | Always `"Feature"` |
| `features[].geometry.type` | string | Always `"Point"` |
| `features[].geometry.coordinates` | [number, number] | [longitude, latitude] in EPSG:4326 |
| `features[].properties.ekatte` | string | EKATTE code (unique settlement ID, 5 digits) |
| `features[].properties.name` | string | Bulgarian name |
| `features[].properties.name_en` | string | Transliterated name |
| `features[].properties.type` | string | Settlement type: "с.", "гр.", "к.к.", etc. |
| `features[].properties.oblast_code` | string | Oblast 3-letter code (e.g. "BLG") |
| `features[].properties.oblast` | string | Oblast name in Bulgarian |
| `features[].properties.obshtina_code` | string | Municipality code |
| `features[].properties.obshtina` | string | Municipality name in Bulgarian |
| `features[].properties.nuts2` | string | NUTS2 region code (e.g. "BG41") |
| `features[].properties.nuts3` | string | NUTS3 code (e.g. "BG413") |
| `features[].properties.population_permanent` | integer | Permanent population (GRAO) |
| `features[].properties.population_current` | integer | Current population (GRAO) |
| `features[].properties.has_pt_access` | boolean | Has at least one matched bus stop |
| `features[].properties.bdp_stop_count` | integer | Number of matched bus stops |

**Response example (single feature):**

```json
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [23.93, 41.54] },
  "properties": {
    "ekatte": "00014", "name": "Абланица", "name_en": "Ablanitsa", "type": "с.",
    "oblast_code": "BLG", "oblast": "Благоевград",
    "obshtina_code": "BLG52", "obshtina": "Хаджидимово",
    "nuts2": "BG41", "nuts3": "BG413",
    "population_permanent": 2777, "population_current": 2650,
    "has_pt_access": true, "bdp_stop_count": 3
  }
}
```

### 3.2 GET /data/stops.geojson

Full bus stop dataset from DA BDP GIS Cloud.

**Response:** `200 OK`, `Content-Type: application/geo+json`

| Field | Type | Description |
|-------|------|-------------|
| `features` | array | 10 280 Feature objects (Point geometry, EPSG:4326) |
| `properties.id` | integer | BDP GIS Cloud unique ID |
| `properties.oblast` | string | Oblast name |
| `properties.municipal` | string | Municipality name |
| `properties.city` | string | Settlement name |
| `properties.road` | string | Road/street name |
| `properties.road_type` | string | Road type classification |
| `properties.settlement_ekatte` | string | Matched settlement EKATTE code |

**Response example (single feature):**

```json
{ "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [23.45, 42.69] },
  "properties": {
    "id": 12345, "oblast": "София", "municipal": "Столична",
    "city": "София", "road": "бул. Витоша", "road_type": "улица",
    "settlement_ekatte": "68134"
  }
}
```

### 3.3 GET /data/coverage/nuts2.json

Aggregated PT coverage statistics by NUTS2 region.

**Response:** `200 OK`, `Content-Type: application/json`

```json
{
  "generated_at": "2026-04-10T12:00:00Z",
  "regions": [
    {
      "nuts2_code": "BG31",
      "nuts2_name": "Северозападен",
      "total_settlements": 742,
      "settlements_with_pt": 389,
      "settlements_without_pt": 353,
      "coverage_pct": 52.4,
      "total_population": 685200,
      "population_with_pt": 612300,
      "population_without_pt": 72900,
      "population_coverage_pct": 89.4,
      "stop_count": 1240
    }
  ]
}
```

### 3.4 GET /data/coverage/oblast.json

Aggregated PT coverage statistics by oblast (28 records).

**Response:** `200 OK`, `Content-Type: application/json`

```json
{
  "generated_at": "2026-04-10T12:00:00Z",
  "oblasts": [
    {
      "oblast_code": "BLG",
      "oblast_name": "Благоевград",
      "nuts3_code": "BG413",
      "total_settlements": 281,
      "settlements_with_pt": 148,
      "settlements_without_pt": 133,
      "coverage_pct": 52.7,
      "total_population": 296800,
      "population_with_pt": 275100,
      "population_without_pt": 21700,
      "population_coverage_pct": 92.7,
      "stop_count": 487
    }
  ]
}
```

### 3.5 GET /data/metadata.json

Dataset metadata: last update timestamp, data sources, record counts.

**Response:** `200 OK`, `Content-Type: application/json`

```json
{
  "version": "1.0",
  "generated_at": "2026-04-10T12:00:00Z",
  "crs": "EPSG:4326",
  "sources": [
    {
      "name": "EKATTE",
      "description": "Единен класификатор на административно-териториалните и териториалните единици",
      "provider": "НСИ",
      "url": "https://www.nsi.bg/nrnm/",
      "records": 5256
    },
    {
      "name": "GRAO",
      "description": "Данни за население по настоящ адрес",
      "provider": "ГД ГРАО",
      "records": 5256
    },
    {
      "name": "BDP_stops",
      "description": "Регистър на автобусни спирки",
      "provider": "ДА БДП",
      "url": "https://bdp.giscloud.com/",
      "records": 10280
    }
  ],
  "layers": {
    "settlements": {
      "file": "settlements.geojson",
      "features": 5256,
      "size_bytes": 3355443
    },
    "stops": {
      "file": "stops.geojson",
      "features": 10280,
      "size_bytes": 3670016
    }
  },
  "license": "CC BY 4.0",
  "contact": "bdp-whitemap@example.bg"
}
```

### 3.6 CORS and caching policy

```
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=86400
ETag: <file-hash>
Content-Encoding: gzip
```

- **CORS:** Unrestricted (`*`) -- allows ArcGIS Online, QGIS, browser apps
- **Caching:** 24-hour max-age; `ETag` for conditional requests
- **Compression:** gzip (automatic on Cloudflare Pages / GitHub Pages)

---

## 4. GeoJSON Schema definitions

### 4.1 Settlement Feature Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://{domain}/schemas/settlement-feature.json",
  "title": "Settlement Feature",
  "description": "A Bulgarian settlement with PT coverage attributes",
  "type": "object",
  "required": ["type", "geometry", "properties"],
  "properties": {
    "type": { "const": "Feature" },
    "geometry": {
      "type": "object",
      "required": ["type", "coordinates"],
      "properties": {
        "type": { "const": "Point" },
        "coordinates": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 2,
          "maxItems": 2,
          "description": "[longitude, latitude] in EPSG:4326"
        }
      }
    },
    "properties": {
      "type": "object",
      "required": [
        "ekatte", "name", "type", "oblast_code", "oblast",
        "obshtina_code", "obshtina", "nuts2", "nuts3",
        "population_permanent", "has_pt_access", "bdp_stop_count"
      ],
      "properties": {
        "ekatte": { "type": "string", "pattern": "^[0-9]{5}$" },
        "name": { "type": "string" },
        "name_en": { "type": "string" },
        "type": { "type": "string", "enum": ["с.", "гр.", "к.к.", "ман.", "гр.ч."] },
        "oblast_code": { "type": "string", "pattern": "^[A-Z]{3}$" },
        "oblast": { "type": "string" },
        "obshtina_code": { "type": "string" },
        "obshtina": { "type": "string" },
        "nuts2": { "type": "string", "pattern": "^BG[0-9]{2}$" },
        "nuts3": { "type": "string", "pattern": "^BG[0-9]{3}$" },
        "population_permanent": { "type": "integer", "minimum": 0 },
        "population_current": { "type": "integer", "minimum": 0 },
        "has_pt_access": { "type": "boolean" },
        "bdp_stop_count": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

### 4.2 BusStop Feature Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://{domain}/schemas/busstop-feature.json",
  "title": "BusStop Feature",
  "description": "A bus stop from the DA BDP inventory",
  "type": "object",
  "required": ["type", "geometry", "properties"],
  "properties": {
    "type": { "const": "Feature" },
    "geometry": {
      "type": "object",
      "required": ["type", "coordinates"],
      "properties": {
        "type": { "const": "Point" },
        "coordinates": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 2,
          "maxItems": 2
        }
      }
    },
    "properties": {
      "type": "object",
      "required": ["id", "oblast", "municipal", "city"],
      "properties": {
        "id": { "type": "integer" },
        "oblast": { "type": "string" },
        "municipal": { "type": "string" },
        "city": { "type": "string" },
        "road": { "type": "string" },
        "road_type": { "type": "string" },
        "settlement_ekatte": {
          "type": "string",
          "pattern": "^[0-9]{5}$",
          "description": "EKATTE code of matched settlement"
        }
      }
    }
  }
}
```

### 4.3 Coverage Aggregation Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://{domain}/schemas/coverage-aggregation.json",
  "title": "Coverage Aggregation",
  "type": "object",
  "required": ["generated_at"],
  "properties": {
    "generated_at": { "type": "string", "format": "date-time" },
    "regions": { "type": "array", "items": { "$ref": "#/$defs/coverage_record" } },
    "oblasts": { "type": "array", "items": { "$ref": "#/$defs/coverage_record" } }
  },
  "$defs": {
    "coverage_record": {
      "type": "object",
      "required": ["total_settlements", "settlements_with_pt", "coverage_pct"],
      "properties": {
        "nuts2_code": { "type": "string" },
        "oblast_code": { "type": "string" },
        "total_settlements": { "type": "integer", "minimum": 0 },
        "settlements_with_pt": { "type": "integer", "minimum": 0 },
        "settlements_without_pt": { "type": "integer", "minimum": 0 },
        "coverage_pct": { "type": "number", "minimum": 0, "maximum": 100 },
        "total_population": { "type": "integer", "minimum": 0 },
        "population_coverage_pct": { "type": "number", "minimum": 0, "maximum": 100 },
        "stop_count": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

---

## 5. ESRI ArcGIS Server съвместимост

### 5.1 Консумиране на GeoJSON като ArcGIS слой

**ArcGIS Online:** Add Layer -> Add Layer from URL -> `https://{domain}/data/settlements.geojson` -> тип "A GeoJSON file". Геометрията и атрибутите се разпознават автоматично.

**ArcGIS Pro (Desktop):** Map -> Add Data -> Data from Path -> URL на GeoJSON файла (поддържано от v2.6+).

**Ограничения:** максимум ~10 000 features за стабилна работа (5 256 settlements -- ОК, 10 280 stops -- на границата); няма server-side филтриране; стилизацията се конфигурира в ArcGIS след зареждане.

### 5.2 WFS endpoint design (Phase 3, бъдещо)

При преминаване към Phase 3, WFS endpoint-ите ще следват OGC WFS 2.0 стандарта. GeoServer ще експонира два FeatureType-а: `whitemap:settlements` и `whitemap:stops`. ArcGIS Server може да федерира WFS endpoints директно като external data sources.

```
GET /wfs?service=WFS&version=2.0.0&request=GetCapabilities
GET /wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=settlements&outputFormat=application/json
GET /wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=stops&bbox=23,42,24,43
```

### 5.3 Координатна референтна система

Всички данни се публикуват в **EPSG:4326** (WGS84) -- стандартът на GeoJSON RFC 7946 и единствената допустима CRS. За институционални нужди с проектирани координати (напр. UTM Zone 35N / EPSG:32635), трансформацията се извършва от консумиращата система. Phase 2 (pygeoapi) поддържа CRS negotiation чрез `crs` параметър.

---

## 6. Обновяване на данните

### 6.1 Честота на обновяване

| Източник | Актуализация | Честота |
|----------|-------------|---------|
| ЕКАТТЕ (НСИ) | Промени в класификатора | Рядко (1-2 пъти годишно) |
| ГРАО население | Данни за население по настоящ адрес | Годишно |
| БДП спирки | Регистър на автобусни спирки | При промяна (месечно до тримесечно) |
| OSM base map | Geofabrik extract | По желание (тримесечно) |

**Целева честота на обновяване на dashboard данните:** Тримесечно или при значима промяна в източниците.

### 6.2 Data pipeline: source refresh -> rebuild -> deploy

```
 1. Source refresh         2. Rebuild                   3. Deploy
 ───────────────          ──────────────               ─────────
 Download latest    -->   npm run build:data     -->   git push / deploy
 EKATTE, GRAO,            (Python pipeline:             to CDN
 BDP data                  merge, validate,
                           generate GeoJSON,
                           aggregate coverage)

 Download OSM PBF   -->   npm run build:tiles    -->   Upload PMTiles
 (optional, rare)         (tilemaker)                  to R2/S3
```

Последователност на `build:data`: обединяване на източници -> двустепенен matching на спирки -> генериране на GeoJSON -> coverage агрегации -> metadata.json -> валидация.

### 6.3 Версиониране

Данните не са версионирани семантично. `metadata.json` съдържа `generated_at` timestamp; HTTP `ETag` се генерира от hash на файла. При бъдещо преминаване към Phase 2, URL пътят ще включва версия: `/api/v1/...`.

---

## 7. Съответствие с Делегиран регламент 2017/1926

### 7.1 Съпоставка с категориите данни от Приложението

Делегиран регламент 2017/1926 определя три категории задължителни данни. Таблицата показва кои от тях настоящият dashboard покрива:

| Категория по Приложението | Подкатегория | Dashboard покрива | Бележка |
|--------------------------|-------------|:-----------------:|---------|
| **Статични данни** | | | |
| Местоположение на спирки (stop location) | Координати, име, идентификатор | Да | `stops.geojson` -- 10 280 спирки с координати от БДП |
| Тип на спирката | Категоризация по вид | Частично | `road_type` е наличен; липсва NeTEx StopPlace type |
| Маршрути (routes) | Номер, начало, край, спирки по маршрут | Не | Не е в обхвата на Фаза 1 |
| Разписания (timetables) | Часове на пристигане/заминаване | Не | Не е в обхвата |
| Тарифи (fares) | Цени на билети | Не | Не е в обхвата |
| Точки за достъп (access nodes) | Входове, оборудване | Не | Не е в обхвата |
| **Динамични данни** | | | |
| Реално време | Закъснения, предвидено пристигане | Не | Не е в обхвата |
| **Свързани услуги** | | | |
| Достъпност | Информация за лица с увреждания | Не | Не е в обхвата |
| Паркинг, споделена мобилност | Налични паркоместа, велосипеди | Не | Не е в обхвата |

### 7.2 Уникален принос на dashboard-а

Бялата карта предоставя данни извън стандартните NAP категории: покритие на населени места (`has_pt_access` за 5 256 точки), население без ОТ (агрегирано по NUTS2/област), гъстота на спирки (`bdp_stop_count`) и геопространствен анализ. Тези данни допълват NAP информацията за маршрути и разписания с цялостна картина на териториалното покритие.

### 7.3 Пътна карта за разширяване на съответствието

1. **Маршрутни данни (Phase 2):** Интегриране на GTFS данни от ИА "АА" за маршрути и разписания
2. **NeTEx идентификатори:** Добавяне на StopPlace/Quay идентификатори при наличие на национален NeTEx регистър
3. **Ниво на обслужване:** Разширяване от бинарно `has_pt_access` към честота (курсове/ден)
4. **Достъпност:** Данни за достъпност на спирките (рампи, тактилни маркировки) при предоставяне от БДП

---

*Край на документа*
