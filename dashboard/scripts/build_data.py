"""
Build production GeoJSON layers from raw data sources.

Input:
  ../data/bg_settlements_with_pt.json  (5,256 settlements with PT flags)
  ../data/stops.db                     (SQLite: stops_bdp + stops_zdoi + stops_unified view)

Output:
  public/data/settlements.geojson
  public/data/stops.geojson
  public/data/coverage_nuts2.json
  public/data/coverage_oblast.json
  public/data/metadata.json
"""

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(os.path.dirname(PROJECT_DIR), "data")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "public", "data")

NUTS2_NAMES = {
    "BG31": "Северозападен",
    "BG32": "Северен централен",
    "BG33": "Североизточен",
    "BG34": "Югоизточен",
    "BG41": "Югозападен",
    "BG42": "Южен централен",
}


def load_settlements():
    path = os.path.join(DATA_DIR, "bg_settlements_with_pt.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_stops():
    db_path = os.path.join(DATA_DIR, "stops.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT uid, source, source_doc_id, source_date,
               lat, lon, oblast, municipal, city,
               road_n, road_t, bdp_date1, bdp_modified_at
        FROM stops_unified
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_municipality_centroid(settlements, obshtina):
    """Get average coordinates of settlements in the same municipality as fallback."""
    coords = [(s["lon"], s["lat"]) for s in settlements if s.get("lon") and s.get("lat") and s.get("obshtina") == obshtina]
    if not coords:
        return 25.5, 42.7  # Bulgaria center
    return sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords)


def build_settlements_geojson(settlements):
    features = []
    for s in settlements:
        lon = s.get("lon")
        lat = s.get("lat")
        if lon is None or lat is None:
            lon, lat = get_municipality_centroid(settlements, s.get("obshtina", ""))

        props = {
            "ekatte": s["ekatte"],
            "name": s["name"],
            "name_en": s.get("name_en", ""),
            "type": s.get("type", ""),
            "oblast": s.get("oblast", ""),
            "oblast_code": s.get("oblast_code", ""),
            "obshtina": s.get("obshtina", ""),
            "nuts2": s.get("nuts2", ""),
            "nuts3": s.get("nuts3", ""),
            "population": s.get("population_permanent") or 0,
            "population_current": s.get("population_current") or 0,
            "has_pt_access": bool(s.get("has_pt_access", False)),
            "stop_count": s.get("bdp_stop_count", 0),
        }

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": props,
        })

    return {"type": "FeatureCollection", "features": features}


def _unix_to_date(ts):
    """Convert a Unix timestamp (seconds) to ISO date string, or None."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")
    except (ValueError, OSError, OverflowError):
        return None


def build_stops_geojson(stops):
    features = []
    for s in stops:
        lon = s.get("lon")
        lat = s.get("lat")
        if lon is None or lat is None:
            continue

        props = {
            "id":            s.get("uid") or s.get("id"),
            "source":        s.get("source", "ДАБДП"),
            "source_doc_id": s.get("source_doc_id") or None,
            "source_date":   s.get("source_date") or None,
            "oblast":        s.get("oblast", ""),
            "municipal":     s.get("municipal", ""),
            "city":          s.get("city", ""),
            "road":          s.get("road_n", ""),
            "road_type":     s.get("road_t", ""),
            "bdp_date":      s.get("bdp_date1") or None,
            "bdp_modified":  _unix_to_date(s.get("bdp_modified_at")),
        }

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": props,
        })

    return {"type": "FeatureCollection", "features": features}


def build_coverage(settlements, group_key, name_map=None):
    groups = defaultdict(lambda: {
        "total": 0, "with_pt": 0, "without_pt": 0,
        "pop_total": 0, "pop_with_pt": 0, "pop_without_pt": 0,
    })

    skipped = 0
    for s in settlements:
        key = s.get(group_key, "")
        if not key:
            skipped += 1
            continue
        pop = s.get("population_permanent") or 0
        has_pt = bool(s.get("has_pt_access", False))

        g = groups[key]
        g["total"] += 1
        g["pop_total"] += pop
        if has_pt:
            g["with_pt"] += 1
            g["pop_with_pt"] += pop
        else:
            g["without_pt"] += 1
            g["pop_without_pt"] += pop

    result = []
    for key, g in sorted(groups.items()):
        entry = {"code": key, **g}
        entry["pct_settlements"] = round(100 * g["with_pt"] / g["total"], 1) if g["total"] > 0 else 0
        entry["pct_population"] = round(100 * g["pop_with_pt"] / g["pop_total"], 1) if g["pop_total"] > 0 else 0
        if name_map and key in name_map:
            entry["name"] = name_map[key]
        elif group_key == "oblast":
            entry["name"] = key
        result.append(entry)

    if skipped:
        print(f"  WARNING: {skipped} settlements skipped (missing '{group_key}')", file=sys.stderr)

    return result


def build_metadata(settlements, stops_count):
    with_pt = sum(1 for s in settlements if s.get("has_pt_access"))
    without_pt = len(settlements) - with_pt
    pop_total = sum(s.get("population_permanent") or 0 for s in settlements)
    pop_with_pt = sum(
        (s.get("population_permanent") or 0)
        for s in settlements if s.get("has_pt_access")
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0",
        "data_sources": {
            "settlements": {"source": "NSI EKATTE", "date": "2026-01-05", "count": len(settlements)},
            "population": {"source": "GRAO", "date": "2026-03-15"},
            "coordinates": {"source": "yurukov/Bulgaria-geocoding (OSM)", "count_with_coords": sum(1 for s in settlements if s.get("lon"))},
            "stops": {
                "sources": [
                    {"name": "ДАБДП", "label": "DA BDP GIS Cloud", "date": "2026-02"},
                    {"name": "ЗДОИ", "label": "FOIA municipal responses", "date": "2024-06"},
                ],
                "count": stops_count,
            },
        },
        "summary": {
            "total_settlements": len(settlements),
            "with_pt_access": with_pt,
            "without_pt_access": without_pt,
            "pct_settlements_with_pt": round(100 * with_pt / len(settlements), 1),
            "population_total": pop_total,
            "population_with_pt": pop_with_pt,
            "population_without_pt": pop_total - pop_with_pt,
            "pct_population_with_pt": round(100 * pop_with_pt / pop_total, 1) if pop_total > 0 else 0,
            "total_stops": stops_count,
        },
    }


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Loading data...")
    settlements = load_settlements()
    stops = load_stops()
    print(f"  Settlements: {len(settlements)}")
    print(f"  Stops: {len(stops)}")

    print("Building settlements.geojson...")
    settlements_gj = build_settlements_geojson(settlements)
    with open(os.path.join(OUTPUT_DIR, "settlements.geojson"), "w", encoding="utf-8") as f:
        json.dump(settlements_gj, f, ensure_ascii=False)
    print(f"  Features: {len(settlements_gj['features'])}")

    print("Building stops.geojson...")
    stops_gj = build_stops_geojson(stops)
    with open(os.path.join(OUTPUT_DIR, "stops.geojson"), "w", encoding="utf-8") as f:
        json.dump(stops_gj, f, ensure_ascii=False)
    print(f"  Features: {len(stops_gj['features'])}")

    print("Building coverage tables...")
    nuts2_coverage = build_coverage(settlements, "nuts2", NUTS2_NAMES)
    with open(os.path.join(OUTPUT_DIR, "coverage_nuts2.json"), "w", encoding="utf-8") as f:
        json.dump(nuts2_coverage, f, ensure_ascii=False, indent=2)
    print(f"  NUTS2 groups: {len(nuts2_coverage)}")

    oblast_coverage = build_coverage(settlements, "oblast")
    with open(os.path.join(OUTPUT_DIR, "coverage_oblast.json"), "w", encoding="utf-8") as f:
        json.dump(oblast_coverage, f, ensure_ascii=False, indent=2)
    print(f"  Oblast groups: {len(oblast_coverage)}")

    print("Building metadata.json...")
    metadata = build_metadata(settlements, len(stops))
    with open(os.path.join(OUTPUT_DIR, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    # Validation
    print("\n=== Validation ===")
    with_pt = metadata["summary"]["with_pt_access"]
    without_pt = metadata["summary"]["without_pt_access"]
    pct_pop = metadata["summary"]["pct_population_with_pt"]

    checks = [
        (len(settlements) == 5256, f"Total settlements: {len(settlements)} (expected 5256)"),
        (with_pt == 1986, f"With PT: {with_pt} (expected 1986)"),
        (without_pt == 3270, f"Without PT: {without_pt} (expected 3270)"),
        (abs(pct_pop - 80.7) < 0.5, f"Population with PT: {pct_pop}% (expected ~80.7%)"),
        (len(settlements_gj["features"]) >= 5252, f"GeoJSON features: {len(settlements_gj['features'])} (expected >= 5252)"),
        (10300 <= len(stops_gj["features"]) <= 10400, f"Stop features: {len(stops_gj['features'])} (expected 10300–10400)"),
    ]

    all_pass = True
    for ok, msg in checks:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {msg}")
        if not ok:
            all_pass = False

    if not all_pass:
        print("\nSome validations failed!")
        sys.exit(1)

    print("\nBuild complete!")
    for fname in os.listdir(OUTPUT_DIR):
        fpath = os.path.join(OUTPUT_DIR, fname)
        size = os.path.getsize(fpath)
        print(f"  {fname}: {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
