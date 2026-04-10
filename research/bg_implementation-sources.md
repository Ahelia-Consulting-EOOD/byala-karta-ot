# Source Log: Bulgaria Implementation Plan

## Web Searches Performed
| # | Query | Date | Results Used |
|---|-------|------|-------------|
| 1 | НСИ ЕКАТТЕ класификатор населени места България download 2024 2025 | 2026-04-10 | NSI NRNM, ekatte.com, GitHub ABPAM/ekatte, GRAO tables |
| 2 | data.egov.bg EKATTE settlements Bulgaria open data | 2026-04-10 | yurukov/Bulgaria-geocoding repo, data.egov.bg portal |
| 3 | НСИ население по населени места 2024 2025 България данни download | 2026-04-10 | NSI population stats, GRAO tables link |
| 4 | GRAO Bulgaria settlements population EKATTE 2024 tables download | 2026-04-10 | NSI ATTD PDF, yurukov geocoding confirmation |

## Documents Read
| # | File Path | Sections Read | Key Data Extracted |
|---|-----------|---------------|-------------------|
| 1 | DATA_MODEL.md | Full document | BDP data model: 10,284 stops, 28 oblasts, 179 municipalities, 748 settlements; fields: oblast, municipal, city_vila, road_t |
| 2 | data_model.schema.json | Full document | Machine-readable schema confirming administrative hierarchy and field types |
| 3 | FINDINGS.md | Full document | 10,280 stops with WGS84 coords; 73.7% match OSM; coordinate quality analysis |
| 4 | bdp_stops_wgs84.json | First 50 lines + full analysis | WGS84 format: id, lon, lat, x_orig, y_orig, oblast, municipal, city, road, road_type; 10,280 records |
| 5 | data/ekatte_nsi/ek_atte.json | Full | 5,256 EKATTE settlements with codes, NUTS, altitude, type |
| 6 | data/ekatte_nsi/ek_obl.json | Full | 29 oblast records with NUTS mapping |
| 7 | data/ekatte_nsi/ek_obst.json | Full | 266 municipality records |
| 8 | data/grao_population_2026_03_utf8.txt | Full parse | 5,138 settlements with March 2026 population (permanent + current address) |
| 9 | data/settlements_yurukov.csv | Full | 5,284 settlements with EKATTE, population (2013), area |
| 10 | data/settlements_loc_yurukov.csv | Full | 5,267 settlement coordinates (WGS84) |

## Web Sources Referenced
| # | URL | Title | Date Accessed | Data Used In Section |
|---|-----|-------|---------------|---------------------|
| 1 | https://www.nsi.bg/nrnm/ | NSI National Register of Settlements | 2026-04-10 | EKATTE data source |
| 2 | https://www.nsi.bg/nrnm/ekatte/index | NSI EKATTE JSON download | 2026-04-10 | Downloaded ek_atte.json (5,256 settlements) |
| 3 | https://www.grao.bg/tables.html | GRAO Population Tables | 2026-04-10 | Population by settlement March 2026 |
| 4 | https://github.com/yurukov/Bulgaria-geocoding | Bulgaria Geocoding Resources | 2026-04-10 | Settlement coordinates, EKATTE-to-location mapping |
| 5 | https://github.com/ABPAM/ekatte | EKATTE PHP library (archived) | 2026-04-10 | Reference only, pointed to NSI as source |
| 6 | https://www.ekatte.com/ | EKATTE classifier website | 2026-04-10 | Reference, mirrors NSI data |
