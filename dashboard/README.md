# Бяла карта на ОТ в България

Национална бяла карта на обществения транспорт - интерактивен dashboard за визуализация на покритието с ОТ за всички 5 256 населени места в България.

## Quick Start

```bash
# Install dependencies
npm install

# Build SQLite stops database from raw sources (run once per source update)
# Requires: ../spirki_transport_raw.json and ../data/zdoi_stops_gps.json
python3 ../scripts/build_stops_db.py

# Build GeoJSON data layers from the database
npm run build:data

# Start development server
npm run dev
```

Open http://localhost:5173

## Features

- **5 256 населени места** with PT access status (green/red markers)
- **10 340 bus stops** with clustering (toggleable layer, two sources: DA BDP + FOIA municipal GPS)
- **Proportional circles** sized by population
- **Filters**: by oblast, municipality, PT status, settlement type
- **Search**: find any settlement by name
- **Sortable tables**: NUTS2 and oblast coverage
- **Click-to-zoom**: click table row to fly to region
- **CSV export**: download filtered data
- **GeoJSON endpoints**: for NAP integration

## Data Sources

| Source | Data | Date |
|--------|------|------|
| NSI EKATTE | 5,256 settlements | 2026-01-05 |
| GRAO | Population by settlement | 2026-03-15 |
| DA BDP (GIS Cloud) | 10,280 bus stops | 2026-02 |
| Municipal FOIA (ЗДОИ) responses | 103 GPS stop coordinates (Трън, Роман, Любимец, Чавдар, Челопеч) | 2024-06 |
| yurukov/Bulgaria-geocoding | Settlement coordinates | OSM-based |

## Tech Stack

- **MapLibre GL JS** - WebGL map renderer
- **Vite** - Build tool
- **TypeScript** - Type-safe code
- **Python** - Data pipeline (`scripts/build_data.py`)
- **Static hosting** - No backend required

## Project Structure

```
dashboard/
  index.html          # Main HTML
  src/
    main.ts           # Application code
    style.css         # Styles
  scripts/
    build_data.py     # Data pipeline
  public/data/        # Generated GeoJSON layers
    settlements.geojson
    stops.geojson
    coverage_nuts2.json
    coverage_oblast.json
    metadata.json
```

## Build for Production

```bash
npm run build
# Output in dist/
```

## Update Data

1. Place updated source files in `../data/` and `../spirki_transport_raw.json`
2. Rebuild the stops database: `python3 ../scripts/build_stops_db.py`
3. Rebuild GeoJSON layers: `npm run build:data`
4. Rebuild dashboard: `npm run build`
