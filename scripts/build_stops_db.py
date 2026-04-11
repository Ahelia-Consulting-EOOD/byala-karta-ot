#!/usr/bin/env python3
"""
Build data/stops.db — SQLite database with two source tables and a unified view.

Sources:
  spirki_transport_raw.json  — DA BDP GIS Cloud export (EPSG:3857, full inspection fields)
  data/zdoi_stops_gps.json   — GPS coordinates from ЗДОИ (FOIA) municipal responses

Output:
  data/stops.db

Tables:
  stops_bdp      — 10,284 stops from DA BDP (WGS84, full fields)
  stops_zdoi     — 103 stops from ЗДОИ GPS responses
  stops_unified  — VIEW: ЗДОИ takes precedence for municipalities with GPS data;
                   BDP used for all others.
"""

import json
import math
import os
import sqlite3
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

BDP_RAW = os.path.join(PROJECT_DIR, "spirki_transport_raw.json")
ZDOI_GPS = os.path.join(PROJECT_DIR, "data", "zdoi_stops_gps.json")
DB_PATH = os.path.join(PROJECT_DIR, "data", "stops.db")

# Municipalities where ЗДОИ GPS data replaces BDP
ZDOI_MUNICIPALITIES = {"Трън", "Роман", "Любимец", "Чавдар", "Челопеч"}


def merc_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert EPSG:3857 (Web Mercator) to WGS84 lat/lon."""
    lon = x * 180.0 / 20037508.342789244
    lat = math.degrees(2 * math.atan(math.exp(y * math.pi / 20037508.342789244)) - math.pi / 2)
    return lat, lon


def load_bdp(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    stops = []
    skipped = 0
    for rec in raw:
        geom = rec.get("__geometry")
        if not geom or geom.get("type") != "Point":
            skipped += 1
            continue
        coords = geom["coordinates"]
        lat, lon = merc_to_wgs84(coords[0], coords[1])

        d = rec.get("data", {})
        stops.append({
            "id": rec["__id"],
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "oblast": d.get("oblast") or "",
            "municipal": d.get("municipal") or "",
            "city": d.get("city_vila") or "",
            "road_n": d.get("road_n") or "",
            "road_t": d.get("road_t") or "",
            "date1": d.get("date1") or None,
            "inspector1": d.get("inspector1") or None,
            "inspector2": d.get("inspector2") or None,
            "element_kod": d.get("element_kod") or None,
            "djob": d.get("djob") or None,
            "ogradni": d.get("ogradni") or None,
            "buferni_t": d.get("buferni_t") or None,
            "osvetyavan": d.get("osvetyavan") or None,
            "znaci": d.get("znaci") or None,
            "created_at": rec.get("__created"),
            "modified_at": rec.get("__modified"),
        })

    if skipped:
        print(f"  BDP: skipped {skipped} records without geometry", file=sys.stderr)
    return stops


def load_zdoi(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def create_schema(conn: sqlite3.Connection) -> None:
    # Build the NOT IN clause from ZDOI_MUNICIPALITIES so the VIEW stays
    # in sync with the Python-level definition — add a new municipality here
    # and the VIEW is rebuilt automatically on next run.
    not_in = ", ".join(f"'{m}'" for m in sorted(ZDOI_MUNICIPALITIES))
    conn.executescript(f"""
        DROP TABLE IF EXISTS stops_bdp;
        DROP TABLE IF EXISTS stops_zdoi;
        DROP VIEW IF EXISTS stops_unified;

        CREATE TABLE stops_bdp (
            id          INTEGER PRIMARY KEY,
            lat         REAL    NOT NULL,
            lon         REAL    NOT NULL,
            oblast      TEXT    NOT NULL DEFAULT '',
            municipal   TEXT    NOT NULL DEFAULT '',
            city        TEXT    NOT NULL DEFAULT '',
            road_n      TEXT    NOT NULL DEFAULT '',
            road_t      TEXT    NOT NULL DEFAULT '',
            date1       TEXT,
            inspector1  TEXT,
            inspector2  TEXT,
            element_kod TEXT,
            djob        TEXT,
            ogradni     TEXT,
            buferni_t   TEXT,
            osvetyavan  TEXT,
            znaci       TEXT,
            created_at  INTEGER,
            modified_at INTEGER
        );

        CREATE TABLE stops_zdoi (
            id            INTEGER PRIMARY KEY,
            lat           REAL    NOT NULL,
            lon           REAL    NOT NULL,
            municipal     TEXT    NOT NULL DEFAULT '',
            name          TEXT    NOT NULL DEFAULT '',
            app_id        TEXT    NOT NULL,
            response_date TEXT,
            source_url    TEXT
        );

        CREATE VIEW stops_unified AS
            -- ЗДОИ rows for municipalities with GPS data
            SELECT
                'zdoi_' || id          AS uid,
                'ЗДОИ'                 AS source,
                app_id                 AS source_doc_id,
                response_date          AS source_date,
                lat,
                lon,
                ''                     AS oblast,
                municipal,
                name                   AS city,
                ''                     AS road_n,
                ''                     AS road_t,
                NULL                   AS bdp_date1,
                NULL                   AS bdp_modified_at
            FROM stops_zdoi

            UNION ALL

            -- BDP rows for all other municipalities
            -- NOTE: inspector1/inspector2 are retained in stops_bdp for internal
            -- analytical use but are intentionally excluded from this view —
            -- they must not be surfaced through the public GeoJSON pipeline.
            SELECT
                'bdp_' || id           AS uid,
                'ДАБДП'                AS source,
                NULL                   AS source_doc_id,
                date1                  AS source_date,
                lat,
                lon,
                oblast,
                municipal,
                city,
                road_n,
                road_t,
                date1                  AS bdp_date1,
                modified_at            AS bdp_modified_at
            FROM stops_bdp
            WHERE municipal NOT IN ({not_in});

        CREATE INDEX idx_bdp_municipal ON stops_bdp(municipal);
        CREATE INDEX idx_zdoi_municipal ON stops_zdoi(municipal);
    """)


def insert_bdp(conn: sqlite3.Connection, stops: list[dict]) -> None:
    conn.executemany("""
        INSERT INTO stops_bdp
            (id, lat, lon, oblast, municipal, city, road_n, road_t,
             date1, inspector1, inspector2, element_kod,
             djob, ogradni, buferni_t, osvetyavan, znaci,
             created_at, modified_at)
        VALUES
            (:id, :lat, :lon, :oblast, :municipal, :city, :road_n, :road_t,
             :date1, :inspector1, :inspector2, :element_kod,
             :djob, :ogradni, :buferni_t, :osvetyavan, :znaci,
             :created_at, :modified_at)
    """, stops)


def insert_zdoi(conn: sqlite3.Connection, stops: list[dict]) -> None:
    conn.executemany("""
        INSERT INTO stops_zdoi
            (id, lat, lon, municipal, name, app_id, response_date, source_url)
        VALUES
            (:id, :lat, :lon, :municipality, :name, :app_id, :response_date, :source_url)
    """, stops)


def validate(conn: sqlite3.Connection) -> bool:
    checks = [
        ("BDP rows",   "SELECT COUNT(*) FROM stops_bdp",   lambda n: 10000 <= n <= 11000),
        ("ЗДОИ rows",  "SELECT COUNT(*) FROM stops_zdoi",  lambda n: n == 103),
        ("Unified",    "SELECT COUNT(*) FROM stops_unified", lambda n: n > 10000),
        ("No ЗДОИ mun in unified BDP",
         "SELECT COUNT(*) FROM stops_unified WHERE source='ДАБДП' AND municipal IN ('Трън','Роман','Любимец','Чавдар','Челопеч')",
         lambda n: n == 0),
        ("ЗДОИ mun in unified",
         "SELECT COUNT(*) FROM stops_unified WHERE source='ЗДОИ'",
         lambda n: n == 103),
    ]
    ok = True
    for label, sql, pred in checks:
        n = conn.execute(sql).fetchone()[0]
        passed = pred(n)
        print(f"  [{'PASS' if passed else 'FAIL'}] {label}: {n}")
        if not passed:
            ok = False
    return ok


def main() -> None:
    print(f"Loading BDP: {BDP_RAW}")
    bdp = load_bdp(BDP_RAW)
    print(f"  Loaded {len(bdp)} stops")

    print(f"Loading ЗДОИ GPS: {ZDOI_GPS}")
    zdoi = load_zdoi(ZDOI_GPS)
    print(f"  Loaded {len(zdoi)} stops")

    print(f"Creating database: {DB_PATH}")
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)

    create_schema(conn)
    print("  Schema created")

    print("Inserting BDP stops...")
    insert_bdp(conn, bdp)
    print("Inserting ЗДОИ stops...")
    insert_zdoi(conn, zdoi)
    conn.commit()

    print("\nValidation:")
    ok = validate(conn)

    conn.close()

    size_kb = os.path.getsize(DB_PATH) // 1024
    print(f"\nDatabase: {DB_PATH} ({size_kb} KB)")

    if not ok:
        print("Validation failed!", file=sys.stderr)
        sys.exit(1)
    print("Done.")


if __name__ == "__main__":
    main()
