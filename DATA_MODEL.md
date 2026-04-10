# BDP GIS Cloud — Reverse-Engineered Data Model

## Methodology

This data model was inferred by analyzing 10,284 records from layer 6542284 (СПИРКИ НА ГРАДСКИ / МЕЖДУГРАДСКИ ТРАНСПОРТ) and 453 records from layer 6542289 (АВТОГАРИ / ЖП ГАРИ), both sourced from the BDP GIS Cloud portal at https://bdp.giscloud.com/.

Each inference is annotated with a **confidence score (1–100)** based on:
- Data completeness and consistency
- Statistical patterns across the full dataset
- Cross-referencing between layers and fields
- Alignment with known GIS Cloud API conventions

---

## 1. System Architecture

### 1.1 Platform Layer (GIS Cloud Envelope)

Every record is wrapped in a GIS Cloud system envelope. These fields are platform-managed, not user-editable.

| Field | Type | Inference | Confidence |
|-------|------|-----------|:----------:|
| `__id` | integer | **Primary key.** Auto-incrementing surrogate key assigned by GIS Cloud. Unique across all 10,284 records, no gaps in the sampled range but not strictly sequential — consistent with a shared sequence across multiple layers or deleted records. | **95** |
| `__owner` | integer \| null | **Foreign key to GIS Cloud user account.** Maps 1:1 to `user_name` in most cases (187 unique owners observed). Null for 67.5% of records — these are bulk-imported records that were not created through the field app. | **90** |
| `__created` | unix timestamp | **Record creation timestamp (UTC).** Present on all 10,284 records. Represents when the record was first persisted to the database, not when the physical inspection occurred (that is `date1`). | **98** |
| `__modified` | unix timestamp | **Last modification timestamp (UTC).** Present on all 10,284 records. Equal to `__created` for 4,744 records (46.1%) — these have never been edited after initial creation. | **98** |
| `__geometry` | GeoJSON Point | **Spatial geometry in EPSG:3857 (Web Mercator).** Present on 10,280/10,284 records (4 records lack geometry). Stores the physical location of the transport stop as a Point feature. This is the authoritative coordinate — the `longitude`/`latitude` attribute fields are vestigial (all zeros). | **97** |
| `__xmin`, `__xmax`, `__ymin`, `__ymax` | float | **Bounding box.** Computed from `__geometry`. For Point features, `xmin==xmax` and `ymin==ymax`. Zero mismatches in sampled data — platform-computed, not user-set. | **99** |

### 1.2 Data Envelope

All domain-specific attributes are nested inside a `data` JSON object. This is a GIS Cloud convention for separating system metadata from layer-specific schema.

**Confidence: 99** — consistent across both layers and documented in GIS Cloud API.

---

## 2. Domain Model — Спирки (Transport Stops)

### 2.1 Entity: Transport Stop (`spirki_26022024`)

**Source table name inferred from layer datasource metadata. The `26022024` suffix indicates the table was created/loaded on 26 February 2024.** Confidence: **92**

**Entity semantics:** Each record represents a single physical transport stop location (bus stop) on the Bulgarian road network. The entity captures both the geographic position and the results of a physical safety inspection. Confidence: **95**

### 2.2 Record Lifecycle

Records exist in exactly one of two states. There are no partial states in the dataset. Confidence: **98**

| State | Count | Pattern |
|-------|-------|---------|
| **Uninspected** | 2,352 (22.9%) | All inspection fields are null: `djob`, `ogradni`, `buferni_t`, `osvetyavan`, `znaci`, `inspector1`, `date1`, `user_name`. Only `oblast`, `municipal`, `road_t`, and geometry are populated. |
| **Inspected** | 7,932 (77.1%) | All 7 inspection fields are populated simultaneously. There are zero records with partial inspection data. This is an all-or-nothing pattern — likely enforced by a mobile form that requires all fields. |

**Inference:** The 2,352 uninspected records were bulk-loaded from an external source (likely a national register or municipal inventory) to serve as a baseline. Inspectors then visit each stop and fill in all inspection fields at once via a mobile data collection app. Confidence: **88**

### 2.3 Fields — Geographic & Administrative

| Field | Type | Nullable | Unique Values | Inference | Confidence |
|-------|------|----------|---------------|-----------|:----------:|
| `oblast` | string | **No** (100%) | 28 | **Administrative region (област).** Corresponds exactly to Bulgaria's 28 oblasts. Lookup/reference value, not free text. Part of a strict hierarchy: област → община → населено място. | **99** |
| `municipal` | string | **No** (100%) | 179 | **Municipality (община).** Strict child of `oblast` — each municipality belongs to exactly one oblast, with one known exception: "Бяла" appears in both Варна and Русе oblasts, which is correct (two different municipalities share the name). | **97** |
| `city_vila` | string | 96.3% | 748 | **Settlement name (населено място).** Free-text field with inconsistent formatting: some prefixed with "с." or "гр.", some include district names (e.g., "Пловдив - район Тракия"), some include neighborhood qualifiers (e.g., "Бургас, кв. Сарафово"). Not a strict lookup — entered by inspectors or bulk-loaded from varying sources. | **92** |
| `road_n` | string | 87.4% | 2,757 | **Street/road name.** Free-text field. Contains street names ("ул. Даме Груев"), road numbers ("E-85"), stop names ("Метростанция Обеля"), landmarks ("Мебелна палата"), or occasionally neighborhood names. High cardinality and inconsistent formatting confirm free-text entry. | **90** |
| `road_t` | enum string | **No** (100%) | 2 | **Road type classifier.** Exactly two values: `"улица"` (street, 8,762 = 85.2%) and `"път"` (road, 1,522 = 14.8%). Distinguishes urban stops (on streets) from intercity stops (on roads). This is the operational meaning of the layer's name "градски / междуградски транспорт". | **97** |

### 2.4 Fields — Inspection Results

All inspection fields share identical population rate (7,932/10,284 = 77.1%), confirming they are filled as a single atomic form submission. Confidence: **98**

| Field | Type | Values | Inference | Confidence |
|-------|------|--------|-----------|:----------:|
| `djob` | enum string | `"ДА"`, `"НЕ"` | **Has bus bay / widening (уширане/джоб)?** Whether the stop has a dedicated pull-in area for buses, separate from the traffic lane. | **90** |
| `ogradni` | enum string | `"ДА"`, `"НЕ"` | **Has fencing/barriers (огради)?** Whether protective fencing is present at the stop. | **88** |
| `buferni_t` | enum string | `"ДА"`, `"НЕ"` | **Has buffer bodies (буферни тела)?** Whether physical crash barriers or bollards are installed to protect waiting passengers. | **85** |
| `osvetyavan` | enum string | `"ДА"`, `"НЕ"`, `"да"` | **Has lighting (осветление)?** One record uses lowercase `"да"` — a data entry inconsistency, semantically identical to `"ДА"`. | **93** |
| `znaci` | enum string | `"ДА"`, `"НЕ"` | **Has road signs (пътни знаци)?** Whether proper signage marks the stop location for drivers. | **90** |
| `date1` | ISO date string | 116 unique dates | **Inspection date.** The date the physical site visit occurred. Range: 2024-05-01 to 2025-07-04. This is distinct from `__created` (when the record was saved to GIS Cloud) — a stop can be created months before inspection. | **95** |

### 2.5 Fields — Personnel & Device

| Field | Type | Nullable | Inference | Confidence |
|-------|------|----------|-----------|:----------:|
| `inspector1` | string | 77.1% | **Primary inspector name.** Free-text field — no validation against a user directory. Contains person names (e.g., "Вера Рускова"), initials ("ГН"), institution references ("Община Трявна"), and data quality issues (PDF attachment JSON leaked into text field, joke names "Мечо Пух"). 388 unique values. | **92** |
| `inspector2` | string | 0.3% | **Secondary inspector name.** Almost entirely unused (29/10,284 non-null). When populated, contains initials ("МК") or "не". The form has this field but it is rarely filled — inspections are overwhelmingly single-person. | **88** |
| `user_name` | string | 77.1% | **GIS Cloud account username of the data submitter.** Follows a naming convention: `{municipality}_municipality` or `{city}_{district}` (e.g., `pernik_municipality`, `sofia_vazrajdane`). Represents the organizational account, not the individual inspector. 240 unique values. Maps predominantly 1:1 to a municipality, with 9 exceptions (cross-municipality users, notably `sars_gov` which spans 55 municipalities — this is a central government/SARS account used for bulk operations). | **93** |
| `device_id` | string | 7.5% | **Mobile device identifier.** Hex strings (e.g., `494f1bd081bc8808`) identifying the Android device used for field data capture. Only populated for 767 records — likely only from the GIS Cloud mobile collector app (MDC). Some records have PDF attachment JSON leaked into this field (same bug as `inspector1`). | **85** |
| `accuracy` | int/float | 69.4% | **GPS accuracy in meters at time of capture.** Values range from 0 to 90. Most are 0 (indicating the point was placed manually on-screen, not GPS-captured) or 3.9–9.6 (typical smartphone GPS accuracy). The value 90 is an outlier — likely a poor fix. | **82** |
| `speed` | integer | 68.6% | **Speed at time of GPS capture (km/h or m/s).** Almost all values are 0 (stationary capture). Non-zero values (1, 2, 7, 8, 9, 40) suggest the inspector was in a moving vehicle during capture. This is automatically recorded by the GPS, not manually entered. | **75** |

### 2.6 Fields — Identification

| Field | Type | Nullable | Inference | Confidence |
|-------|------|----------|-----------|:----------:|
| `element_kod` | numeric string | 67.5% | **Stop code / sequential identifier.** Numeric values as strings, 6,943 non-null with 6,942 unique (one duplicate: code "487"). This is likely the stop's identifier from the national road safety database or municipal register — not the GIS Cloud `__id`. Only populated for inspected stops, suggesting codes are assigned during or after inspection. | **80** |
| `longitude` | integer | 67.5% | **Vestigial longitude field.** All non-null values are `0`. The actual coordinates are stored in `__geometry`. This field exists in the form schema but was never populated — the mobile app writes directly to the geometry column. | **95** |
| `latitude` | integer | 67.5% | **Vestigial latitude field.** Same as longitude — all zeros. The form schema includes these fields but the app ignores them in favor of `__geometry`. | **95** |

### 2.7 Fields — Media

| Field | Type | Nullable | Inference | Confidence |
|-------|------|----------|-----------|:----------:|
| `foto1` | string (JSON) | 0.2% | **Photo attachment reference.** When populated, contains a `___json[...]` wrapper with a JSON object describing an uploaded file: `pathname`, `rid` (resource ID on GIS Cloud storage), `lid` (layer ID), `fid` (feature ID), `field`, `title`, `ext`. Photos are stored on GIS Cloud's asset server, not inline. Only 25/10,284 records have photos — the vast majority of inspections did not include photographic evidence. | **90** |
| `foto2` | string | 0.0% | **Second photo attachment.** Effectively unused (2 non-null records, both containing "не" = "no"). The form allows two photos but inspectors almost never attach any. | **92** |

### 2.8 Fields — Vestigial / Broken

| Field | Type | Nullable | Inference | Confidence |
|-------|------|----------|-----------|:----------:|
| `class_str` | string | 0.3% | **Unknown classifier — possibly road width class.** Only 32/10,284 non-null. Values include "до 8м." (up to 8m), "не" (no), and one misplaced value "Васил Левски" (a street name). This field was likely planned for road width classification but was abandoned or replaced. | **60** |

---

## 3. Domain Model — Автогари / ЖП Гари (Stations)

### 3.1 Entity: Bus/Train Station (`avtogari_jpgari`)

453 records representing fixed transport terminals. Shares a common base schema with transport stops (15 common fields) but has station-specific attributes.

### 3.2 Schema Relationship to Спирки

| Category | Fields | Inference | Confidence |
|----------|--------|-----------|:----------:|
| **Common base** | `oblast`, `municipal`, `city_vila`, `date1`, `inspector1`, `inspector2`, `user_name`, `device_id`, `accuracy`, `speed`, `longitude`, `latitude`, `foto1`, `foto2`, `osvetyavan` | Both layers inherit from a shared "transport infrastructure element" base form. The common fields cover location, inspection metadata, and lighting. | **88** |
| **Spirki-specific** | `road_n`, `road_t`, `djob`, `ogradni`, `buferni_t`, `znaci`, `element_kod`, `class_str` | Stops are road-side infrastructure: they need road context (`road_n/t`), safety features (`djob`, `ogradni`, `buferni_t`), and signage (`znaci`). | **92** |
| **Avtogari-specific** | `name`, `tip_element`, `parkingi`, `znaci_mark`, `data_2`, `time`, `element_cod` | Stations are named facilities (`name`), classified by type (`tip_element`), and have parking (`parkingi`). Note the subtle field name difference: `element_kod` (spirki) vs `element_cod` (avtogari) — likely a typo in one schema definition. | **90** |

### 3.3 Station-Specific Fields

| Field | Type | Values | Inference | Confidence |
|-------|------|--------|-----------|:----------:|
| `tip_element` | enum string | `"Автогара"`, `"ЖП гара"` | **Station type.** Bus station vs railway station. Present on all 453 records. | **99** |
| `name` | string | 182 unique | **Station name.** E.g., "Автогара Подуяне", "ЖП гара Пловдив". More structured than `road_n` in the stops layer — these are named facilities, not road positions. | **95** |
| `parkingi` | enum string | `"ДА"`, `"НЕ"` | **Has parking facilities?** | **90** |
| `znaci_mark` | enum string | `"ДА"`, `"НЕ"` | **Has signs/markings?** Equivalent to `znaci` in the stops layer but with a different field name. | **85** |
| `data_2` | — | 0% populated | **Unused field.** Reserved in schema but never populated. Possibly planned for a secondary date (e.g., follow-up inspection). | **50** |
| `time` | — | 0% populated | **Unused field.** Possibly planned for recording time of inspection or station operating hours. | **45** |

---

## 4. Relationships & Hierarchies

### 4.1 Administrative Hierarchy

```
област (28) ──1:N──► община (179) ──1:N──► населено място (748)
```

- **Oblast → Municipal**: Strict 1:N. Each municipality belongs to exactly one oblast. One apparent conflict ("Бяла" in both Варна and Русе) is correct — two distinct municipalities share the name. Confidence: **97**
- **Municipal → City/Village**: Loose 1:N. `city_vila` is free-text, not a foreign key to a lookup table. Multiple spelling variants exist for the same settlement. Confidence: **85**

### 4.2 User / Ownership Model

```
GIS Cloud Account (__owner) ──1:1──► user_name ──N:1──► община
```

- **`__owner` → `user_name`**: Predominantly 1:1 (187 unique owners map to 240 user_names, some owners have used multiple accounts). Confidence: **82**
- **`user_name` → `municipal`**: Predominantly 1:1 (231/240 users operate within a single municipality). 9 exceptions exist, most notably `sars_gov` (55 municipalities) which is a central State Agency for Road Safety (SARS) account. Confidence: **90**
- **Inspector ≠ User**: `inspector1` (person name) is independent of `user_name` (account). Multiple inspectors share one municipal account. They are not linked by a foreign key — `inspector1` is free text. Confidence: **93**

### 4.3 Cross-Layer Relationship

The two layers (спирки and автогари) share a map (`2674312`) and common base schema but have **no foreign key relationship**. They represent the same conceptual domain (transport infrastructure) at different granularity levels (individual stops vs terminal facilities). `element_kod`/`element_cod` values do not cross-reference between layers.

Confidence: **88**

---

## 5. Data Quality Observations

| Issue | Scope | Confidence |
|-------|-------|:----------:|
| `inspector1` contains PDF attachment JSON (`___json[...]`) — a field-mapping bug in the mobile form where a file-upload widget wrote to a text field | ~60 records in spirki | **95** |
| `device_id` contains same PDF attachment JSON — identical bug, different field | ~30 records | **95** |
| `longitude`/`latitude` fields exist but contain only zeros — actual coords are in `__geometry` | 6,942 records | **99** |
| `osvetyavan` has inconsistent casing (`"ДА"` vs `"да"`) — no input normalization | 1 record | **98** |
| `element_kod` has one duplicate value ("487" appears twice) — either a data entry error or two sides of the same stop | 2 records | **90** |
| Inspector names have inconsistent formatting: casing variations ("йовка минкова" vs "Йовка Минкова"), trailing spaces, abbreviation inconsistency | ~50 inspector identities | **92** |
| `class_str` contains misplaced data ("Васил Левски" is a street name, not a classification) | 1 record | **88** |
| `foto1`/`foto2` are essentially unpopulated (25 and 2 records respectively) despite the form supporting photo uploads | Dataset-wide | **97** |
| Spelling variant `element_kod` (spirki) vs `element_cod` (avtogari) — likely a typo in one layer's schema definition, not intentional | Both layers | **85** |

---

## 6. Inferred System Context

| Inference | Evidence | Confidence |
|-----------|----------|:----------:|
| **The system is the Bulgarian Road Safety (БДП) municipal inspection platform** | Layer naming, domain fields, `sars_gov` user account (State Agency for Road Safety), portal URL `bdp.giscloud.com` | **95** |
| **Data collection uses GIS Cloud Mobile Data Collection (MDC) app on Android** | `device_id` contains Android device hex IDs, `accuracy`/`speed` are GPS metadata auto-captured by MDC, photo paths reference `Collected Media/map_*/layer_*` MDC structure | **90** |
| **Uninspected records (2,352) were bulk-imported from a national register** | They have no `__owner`, no `user_name`, no inspection fields, but do have precise geometry and complete administrative location — consistent with a pre-loaded baseline from НКПД or municipal GIS | **85** |
| **The inspection campaign started in May 2024** | 72.8% of records created in May 2024, inspection dates begin 2024-05-01 | **97** |
| **Each municipality has a dedicated GIS Cloud account** | `user_name` pattern `{municipality}_municipality`, 231/240 users tied to single municipality | **93** |
| **The February 2026 bulk edit was a centralized QA review** | 625 modifications, 0 creations, 65.8% with `__owner: null` (admin/batch), 2 inspectors covered 60% of edits, workday-only pattern | **92** |
| **The mobile form enforces all-or-nothing field completion** | 100% co-occurrence of all 7 inspection fields — zero partial records across 10,284 entries | **96** |

---

*Model inferred on 2026-04-10 from live API data. Confidence scores reflect the strength of evidence, not certainty — independent verification is recommended for scores below 80.*
