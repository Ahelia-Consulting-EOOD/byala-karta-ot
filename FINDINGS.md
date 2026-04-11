# BDP GIS Cloud vs OpenStreetMap: Transport Stop Coordinate Analysis

> **Scope note:** This analysis covers the BDP GIS Cloud dataset only (10,280 stops with valid geometry). The production dashboard uses a unified dataset that also incorporates 103 GPS coordinates from municipal FOIA (ЗДОИ) responses for Трън, Роман, Любимец, Чавдар, and Челопеч (total: 10,340 stops). See DATA_MODEL.md §7 for the multi-source architecture.

## 1. Data Sources

### BDP GIS Cloud
- **Portal**: https://bdp.giscloud.com/
- **Layer**: 6542284 — СПИРКИ НА ГРАДСКИ / МЕЖДУГРАДСКИ ТРАНСПОРТ
- **Total stops**: 10,284 (10,280 with valid geometry)
- **Coordinate system**: EPSG:3857 (Web Mercator), converted to WGS84 for comparison
- **Source table**: PostgreSQL `spirki_26022024`
- **Supplementary layer**: 6542289 — АВТОГАРИ / ЖП ГАРИ (453 stations)

### OpenStreetMap
- **Query**: Overpass API — `highway=bus_stop`, `public_transport=platform[bus=yes]`, `public_transport=stop_position[bus=yes]`
- **Bounding box**: Bulgaria (41.23–44.21N, 22.35–28.61E)
- **Total stops**: 10,059 (7,790 with names)

### Data Attributes (BDP)

| Field | Bulgarian Label | Description |
|-------|----------------|-------------|
| `element_kod` | КОД НОМЕР | Unique stop code |
| `date1` | ДАТА ОГЛЕД | Inspection date |
| `oblast` | ОБЛАСТ | Region |
| `municipal` | ОБЩИНА | Municipality |
| `city_vila` | НАСЕЛЕНИЕ МЯСТО | Settlement |
| `road_n` | ИМЕ НА ПЪТ / УЛИЦА | Street/road name |
| `road_t` | ПЪТ / УЛИЦА | Road type |
| `djob` | НАЛИЧНОСТ УШИРАНЕ / ДЖОБ? | Has bus bay/widening? |
| `ogradni` | НАЛИЧНИ ЛИ СА ОГРАДИ? | Has fencing? |
| `buferni_t` | ОБЕЗОПАСЕНА ЛИ Е С БУФЕРНИ ТЕЛА? | Has buffer bodies? |
| `osvetyavan` | НАЛИЧНОСТ ОСВЕТЛЕНИЕ? | Has lighting? |
| `znaci` | НАЛИЧНИ ЛИ СА ПЪТНИ ЗНАЦИ? | Has road signs? |
| `foto1`, `foto2` | СНИМКА / СНИМКИ | Photo URLs |
| `inspector1`, `inspector2` | ИНСПЕКТИРАЛ | Inspector name(s) |
| `longitude`, `latitude` | — | Coordinate fields (mostly unpopulated) |
| `accuracy`, `speed` | — | GPS metadata |

---

## 2. Matching Methodology

Each BDP stop was matched to its nearest OSM stop using the Haversine formula, with a spatial grid index (0.01° cells, ~1km) and a search radius of ±2 cells (~2km). Matches were accepted within a 500m threshold.

---

## 3. Matching Summary

| Category | Count | Percentage |
|----------|-------|------------|
| BDP stops with geometry | 10,280 | 100% |
| Matched to OSM (within 500m) | **7,577** | 73.7% |
| No OSM match found | **2,703** | 26.3% |

---

## 4. Distance Distribution

| Distance Range | Count | Percentage | Interpretation |
|----------------|-------|------------|----------------|
| < 5m | **6,029** | 79.6% | Exact match — identical or near-identical position |
| 5–15m | 460 | 6.1% | GPS noise — normal variance from field capture |
| 15–30m | 252 | 3.3% | Minor shift — opposite side of road, slight correction |
| 30–50m | 147 | 1.9% | Moderate deviation |
| 50–100m | 211 | 2.8% | Significant deviation — warrants review |
| 100–200m | 163 | 2.2% | Large deviation — likely wrong position or intentional move |
| 200–500m | 315 | 4.2% | Possible mismatch — may be matching to wrong OSM stop |

### Statistical Summary

| Metric | Value |
|--------|-------|
| Mean distance | 21.5m |
| Median distance | 0.0m |
| 90th percentile | 38.8m |
| 95th percentile | 153.2m |
| 99th percentile | 404.5m |

---

## 5. Key Finding: Editing Correlation

To determine whether coordinate deviations are the result of post-creation edits in the BDP system, we compared the editing rate (records where `__created != __modified`) between close and deviated stops.

| Group | Edited After Creation | Total | Edit Rate |
|-------|----------------------|-------|-----------|
| Close to OSM (<50m) | 4,520 | 6,888 | **65.6%** |
| Deviated from OSM (≥50m) | 204 | 689 | **29.6%** |

### Interpretation

**Counter-intuitive result**: Stops that are *closer* to OSM are *more likely* to have been edited. This strongly suggests that edits in the BDP system generally **improved** coordinate accuracy — correcting positions toward the ground truth represented by OSM.

The 689 stops with ≥50m deviation are predominantly **original GPS captures that were never corrected**, not stops whose coordinates were deliberately moved away from their true position.

132 stops exhibit both large deviation (≥100m from OSM) AND post-creation modification. These are the strongest candidates for intentional coordinate edits or correction attempts that did not fully resolve the positional error.

---

## 6. Deviation by Oblast

| Oblast | Deviated (≥50m) | Total Matched | Deviation Rate |
|--------|----------------|---------------|----------------|
| Разград | 29 | 69 | **42.0%** |
| Кърджали | 27 | 74 | **36.5%** |
| Търговище | 10 | 29 | **34.5%** |
| Силистра | 1 | 3 | 33.3% |
| Кюстендил | 35 | 139 | **25.2%** |
| Перник | 11 | 60 | 18.3% |
| Русе | 45 | 275 | 16.4% |
| Плевен | 25 | 161 | 15.5% |
| Хасково | 10 | 81 | 12.3% |
| Смолян | 8 | 81 | 9.9% |
| София-град | 273 | 2,838 | 9.6% |
| Пловдив | 53 | 669 | 7.9% |
| Бургас | 35 | 455 | 7.7% |
| София (обл.) | 16 | 196 | 8.2% |
| Ямбол | 12 | 146 | 8.2% |
| Добрич | 13 | 204 | 6.4% |
| Ловеч | 7 | 110 | 6.4% |
| Стара Загора | 24 | 451 | 5.3% |
| Варна | 27 | 562 | 4.8% |
| Шумен | 7 | 175 | 4.0% |
| Габрово | 9 | 244 | 3.7% |
| Велико Търново | 6 | 231 | 2.6% |
| Видин | 1 | 43 | 2.3% |
| Пазарджик | 4 | 49 | 8.2% |
| Сливен | 1 | 58 | 1.7% |

Разград, Кърджали, and Търговище show the highest deviation rates, suggesting lower data quality or different data capture methods in these regions.

---

## 7. Unmatched BDP Stops (No OSM Counterpart)

2,703 BDP stops (26.3%) have no OSM bus stop within 500m. Top oblasts:

| Oblast | Unmatched Stops |
|--------|----------------|
| Кърджали | 424 |
| Плевен | 198 |
| Добрич | 179 |
| Велико Търново | 165 |
| Търговище | 157 |
| Кюстендил | 139 |
| Бургас | 129 |
| Русе | 114 |
| Шумен | 110 |
| София | 100 |
| Стара Загора | 98 |
| Перник | 92 |
| Пловдив | 92 |
| Варна | 90 |
| Монтана | 83 |

These stops either do not exist in OSM, were recently added in the BDP system, or are located in rural areas with poor OSM coverage.

---

## 8. Monthly Activity

| Month | Created | Modified | Created (Cumulative) | Modified (Cumulative) |
|-------|---------|----------|---------------------|-----------------------|
| 2024-05 | 7,482 | 2,932 | 7,482 | 2,932 |
| 2024-06 | 1,053 | 2,262 | 8,535 | 5,194 |
| 2024-07 | 1,112 | 2,870 | 9,647 | 8,064 |
| 2024-08 | 435 | 1,057 | 10,082 | 9,121 |
| 2024-10 | 0 | 2 | 10,082 | 9,123 |
| 2025-05 | 71 | 137 | 10,153 | 9,260 |
| 2025-06 | 45 | 172 | 10,198 | 9,432 |
| 2025-07 | 86 | 227 | 10,284 | 9,659 |
| 2026-02 | 0 | **625** | 10,284 | 10,284 |

### Observations

- **May 2024**: Bulk initial load — 7,482 records created (72.8% of all data)
- **Jun–Aug 2024**: Continued data entry and corrections — 2,600 new stops + heavy editing
- **Oct 2024**: Minimal activity (2 edits)
- **May–Jul 2025**: Second wave — 202 new stops created, 536 modifications
- **Feb 2026**: **Bulk edit session** — 625 modifications with zero new records. This is a significant data quality review/correction pass

Total records edited after creation: **5,540 / 10,284 (53.9%)**

---

## 9. Inspector Coverage

| Metric | Count |
|--------|-------|
| Stops with inspector(s) assigned | 7,932 (77.1%) |
| Stops with valid inspector names | 6,931 (67.4%) |
| Unique inspector names | 473 |
| Stops without any inspector | 2,352 (22.9%) |

### Top Inspectors by Volume

| Inspector | Stops Inspected |
|-----------|----------------|
| Инспектор A | 395 |
| Инспектор B | 327 |
| Инспектор C | 283 |
| Инспектор D | 190 |
| Инспектор E | 187 |
| Инспектор F | 159 |
| Инспектор G | 151 |
| Инспектор H | 133 |
| Инспектор I | 131 |
| Инспектор J | 125 |
| Инспектор K | 124 |
| Инспектор L | 123 |
| Инспектор M | 113 |
| Инспектор N | 143 |
| Инспектор O | 108 |
| Инспектор P | 107 |
| Инспектор Q | 103 |
| Инспектор R | 98 |
| Инспектор S | 94 |

### Data Quality Notes

Some inspector fields contain non-name values:
- PDF file attachment JSON (`___json[...]`) — 60 records
- Single-character or initials-only entries
- Joke/test names (напр. измислени/тестови имена) — 5 records
- Inconsistent casing/spacing for same inspector (напр. различен регистър за един и същ инспектор)

---

## 10. Top 20 Most Deviated Stops

| BDP ID | Distance (m) | City | Street | OSM Name |
|--------|-------------|------|--------|----------|
| 9716 | 497.3 | Дупница | Ловджийска среща | — |
| 8874 | 494.5 | Хисаря | Калифея | — |
| 10642 | 494.5 | Спасовци | Спасовци | Иванковци |
| 10177 | 493.6 | с. Самораново | Самораново | — |
| 8963 | 491.5 | Кърджали | Райна Княгиня | — |
| 8966 | 488.8 | Брестовица | ул.Кирил Томов | център Брестовица |
| 9561 | 486.9 | Димитровград | — | — |
| 8575 | 486.0 | Кайнарджа | автобусна спирка | — |
| 9585 | 485.7 | Свищов | ул. Цар Освободител | — |
| 8094 | 482.4 | Чирпан | — | — |
| 9663 | 480.6 | Дупница | Ловджийска среща | — |
| 8093 | 480.1 | Чирпан | — | — |
| 8761 | 476.7 | Крумовград | Св. Св. Кирил и Методий | — |
| 8965 | 476.0 | Кърджали | Захари Зограф | — |
| 8882 | 475.3 | Хисаря | Калифея | — |
| 9589 | 473.8 | Свищов | ул. Петър Ангелов | — |
| 7869 | 473.2 | гр.Елхово | Александър Стамболийски | — |
| 8150 | 472.4 | гр. Куклен | ул. Ал. Стамболийски | — |
| 10093 | 469.4 | Дупница | Чепкалото | — |
| 8872 | 468.0 | Хисаря | Център | — |

---

## 11. Likely Coordinate Edits (Modified + Deviated ≥100m)

132 stops show both large spatial deviation from OSM AND evidence of post-creation modification. Sample:

| BDP ID | Deviation | City | Street | Created | Modified | Days Between |
|--------|-----------|------|--------|---------|----------|-------------|
| 8965 | 476.0m | Кърджали | Захари Зограф | 2024-07-03 | 2024-07-03 | 0 |
| 9932 | 456.3m | гр. Бяла | Трифон Милушев | 2024-07-30 | 2024-07-31 | 1 |
| 9147 | 454.5m | с. Осенец | ул. Стефан Радков | 2024-07-08 | 2024-07-22 | 14 |
| 7380 | 454.0m | с. Градец | Градец | 2024-05-17 | 2026-02-11 | 635 |
| 7690 | 452.8m | гр. Разград | сп. Автогара | 2024-05-28 | 2024-05-28 | 0 |
| 4531 | 447.9m | Ямбол | — | 2024-05-01 | 2024-07-11 | 71 |
| 4084 | 447.5m | София-град | ул. Зографски Манастир | 2024-05-01 | 2024-07-10 | 70 |
| 9406 | 444.0m | Стоб | с. Стоб | 2024-07-12 | 2024-07-18 | 5 |
| 9745 | 433.9m | Бургас, кв. Сарафово | Керамичен завод Р2Б | 2024-07-25 | 2026-02-03 | 558 |
| 7236 | 426.9m | Левски | Ал. Стамболийски | 2024-05-15 | 2026-02-09 | 635 |

---

## 12. Conclusions

1. **~80% of BDP stops align precisely with OSM** (within 5m), indicating the same underlying data source or consistent field surveys.

2. **Edits improve accuracy**: The higher editing rate among close stops (65.6%) vs deviated stops (29.6%) demonstrates that post-creation modifications in the BDP system move coordinates *toward* the correct position, not away from it.

3. **478 stops (6.3%) deviate significantly** (≥100m from OSM). Most of these are unedited original captures with poor GPS accuracy, not intentionally relocated points.

4. **132 stops** are both deviated and modified — these warrant manual review as potential coordinate manipulation or failed correction attempts.

5. **Regional quality varies widely**: Разград (42.0%), Кърджали (36.5%), and Търговище (34.5%) have the highest deviation rates, suggesting different data capture quality standards or equipment.

6. **2,703 BDP stops** (26.3%) have no OSM counterpart, concentrated in Кърджали (424), Плевен (198), and Добрич (179) — likely rural stops absent from OSM.

7. **February 2026 bulk edit**: 625 records were modified with no new records created, indicating a systematic data quality review pass (see Section 12a for detailed breakdown).

---

## 12a. February 2026 Bulk Edit — Deep Dive

### Geographic Clustering

The 625 modifications in February 2026 are heavily concentrated in two oblasts:

| Oblast | Edits | Share |
|--------|-------|-------|
| **Пловдив** | 326 | **52.2%** |
| **Кърджали** | 99 | 15.8% |
| Бургас | 30 | 4.8% |
| София (обл.) | 29 | 4.6% |
| Плевен | 15 | 2.4% |
| Монтана | 15 | 2.4% |
| Силистра | 14 | 2.2% |
| Видин | 13 | 2.1% |
| Шумен | 11 | 1.8% |
| Габрово | 10 | 1.6% |
| Варна | 10 | 1.6% |
| Other (14 oblasts) | 53 | 8.5% |

### Пловдив: District-Level Breakdown (326 edits)

| District | Edits |
|----------|-------|
| район Централен | 69 |
| район Тракия | 61 |
| район Източен | 51 |
| район Западен | 48 |
| район Южен | 44 |
| район Северен | 34 |
| Other (Съединение, Първомай, Родопи, Брезово, Стамболийски) | 19 |

**Key actor: Инспектор A** — responsible for **284 of 326 Пловдив edits (87%)**. She is also the #1 inspector overall (395 stops total), indicating she "owns" the Plovdiv data and conducted a systematic quality pass across all six city districts.

### Кърджали: Concentrated in Община Кирково (91/99 edits)

**Key actor: Инспектор Q** — responsible for **90 of 91 Кирково edits**. Another single-inspector systematic review of a specific municipality.

### Municipality Breakdown (Top 15)

| Oblast / Municipality | Edits |
|-----------------------|-------|
| Пловдив / Пловдив | 314 |
| Кърджали / Кирково | 91 |
| София / Костинброд | 20 |
| Бургас / Бургас | 19 |
| Силистра / Алфатар | 14 |
| Монтана / Монтана | 14 |
| Видин / Видин | 13 |
| Шумен / Смядово | 11 |
| Габрово / Габрово | 10 |
| Велико Търново / В. Търново | 9 |
| Плевен / Долни Дъбник | 8 |
| Бургас / Поморие | 7 |
| Перник / Трън | 5 |
| Плевен / Левски | 5 |
| Благоевград / Разлог | 5 |

### Timeline (Working Days)

| Date | Edits |
|------|-------|
| 2026-02-02 | 1 |
| 2026-02-03 | 26 |
| 2026-02-04 | 18 |
| 2026-02-06 | 42 |
| 2026-02-09 | 65 |
| 2026-02-10 | 40 |
| **2026-02-11** | **129** |
| 2026-02-12 | 86 |
| 2026-02-16 | 56 |
| **2026-02-17** | **130** |
| 2026-02-18 | 29 |
| 2026-02-19 | 3 |

The work spanned 8 working days (Feb 3–19), with two peak days: Feb 11 (129) and Feb 17 (130).

### Inspector Attribution

| Inspector | Edits | Primary Area |
|-----------|-------|-------------|
| Инспектор A | 284 | Пловдив (all districts) |
| Инспектор Q | 90 | Кирково, обл. Кърджали |
| Инспектор T | 25 | Various |
| Инспектор U | 20 | Костинброд, обл. София |
| Инспектор V | 14 | Алфатар, обл. Силистра |
| Инспектор W | 14 | Монтана |
| Инспектор X | 11 | Смядово, обл. Шумен |
| ЗП | 10 | Габрово |
| Инспектор Y | 9 | Велико Търново |
| Инспектор Z | 8 | Долни Дъбник, обл. Плевен |

### Owner ID Analysis

| Owner | Edits | Interpretation |
|-------|-------|---------------|
| None (batch/admin) | 411 | 65.8% — desk-based corrections, not field app |
| 250966 | 91 | -- |
| 278816 | 16 | — |
| 251132 | 14 | — |
| 250987 | 14 | — |
| Other (31 owners) | 79 | Small corrections by various users |

### Interpretation

This is an **organized QA campaign**, not random edits:

1. **Two dominant inspectors** (Инспектор A + Инспектор Q) account for **374 of 625 edits (59.8%)**, each systematically reviewing their respective territories.
2. **65.8% of edits have `owner: None`**, indicating batch or admin-level modifications — consistent with a desk-based coordinate correction session rather than field data capture.
3. The two-week timeframe and workday-only pattern confirm this was a planned, supervised review process.
4. The geographic completeness within Plovdiv (all 6 city districts covered proportionally) suggests a full municipal audit rather than selective corrections.

---

## 13. Output Files

| File | Records | Description |
|------|---------|-------------|
| `spirki_transport_raw.json` | 10,284 | Full BDP dataset (raw API response) |
| `spirki_transport.geojson` | 10,284 | BDP stops as GeoJSON |
| `avtogari_jp_gari_raw.json` | 453 | Bus/train stations (raw) |
| `avtogari_jp_gari.geojson` | 453 | Stations as GeoJSON |
| `bdp_stops_wgs84.json` | 10,280 | BDP stops converted to WGS84 |
| `osm_bus_stops_bg.json` | 10,059 | OSM bus stops for Bulgaria |
| `spirki_with_inspectors.json` | 6,931 | Stops with valid inspector names |
| `comparison_matches.json` | 7,577 | All matched BDP↔OSM pairs with distances |
| `comparison_no_match.json` | 2,703 | BDP stops with no OSM counterpart |
| `comparison_deviated.json` | 478 | Stops ≥100m from nearest OSM match |
| `likely_coordinate_edits.json` | 132 | Deviated + modified stops |
| `spirki_monthly_stats.csv` | 9 rows | Monthly created/modified counts |
| `feb2026_edits.json` | 625 | February 2026 bulk edit records with geographic detail |

---

*Analysis performed on 2026-04-08. BDP data accessed via GIS Cloud REST API (unauthenticated). OSM data via Overpass API.*
