"""Build the Punjab (India) pind map data from OpenStreetMap.

Downloads the state border, district borders and every village/hamlet/town
point, then turns the points into Voronoi "territory" cells clipped to the
state border -- a seamless game-style grid where each cell is one pind.

Outputs (in ../data):
  punjab_outline.json  state border (GeoJSON Feature)
  punjab_pinds.json    pind cells (GeoJSON FeatureCollection)

Run:  .venv/Scripts/python.exe tools/build_pinds.py
"""
import json
import pathlib
import time

import requests
from shapely import voronoi_polygons
from shapely.geometry import LineString, MultiPoint, Point, mapping
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / "tools" / "cache"
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
HEADERS = {"User-Agent": "punjab-explorer/1.0 (personal travel map)"}
AREA = 'area["ISO3166-2"="IN-PB"]->.pb;'


def overpass(name, query):
    """Run an Overpass query, caching the result on disk."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{name}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    for attempt in range(4):
        for url in SERVERS:
            try:
                r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=400)
                if r.status_code == 200:
                    cached.write_text(r.text, encoding="utf-8")
                    return r.json()
                print(f"  {url} -> {r.status_code}")
            except requests.RequestException as e:
                print(f"  {url} -> {e}")
        time.sleep(20 * (attempt + 1))
    raise SystemExit(f"Overpass query '{name}' failed")


def relation_polygon(rel):
    """Assemble a relation's outer ways (from `out geom`) into a polygon."""
    lines = [
        LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        for m in rel["members"]
        if m["type"] == "way" and m.get("role", "outer") in ("outer", "") and "geometry" in m
    ]
    return unary_union(list(polygonize(unary_union(lines))))


def main():
    DATA.mkdir(exist_ok=True)

    print("Fetching state border...")
    state = overpass("state", '[out:json][timeout:300];rel["ISO3166-2"="IN-PB"];out geom;')
    outline = relation_polygon(state["elements"][0]).simplify(0.0005)
    print(f"  area {outline.area:.2f} deg^2")

    print("Fetching district borders...")
    dist = overpass("districts", f'[out:json][timeout:300];{AREA}rel(area.pb)["boundary"="administrative"]["admin_level"="5"];out geom;')
    districts = []
    for rel in dist["elements"]:
        poly = relation_polygon(rel)
        if not poly.is_empty and poly.intersects(outline):
            name = rel["tags"].get("name:en") or rel["tags"].get("name", "")
            districts.append((name.replace(" District", "").replace(" district", ""), poly))
    print(f"  {len(districts)} districts")
    dist_tree = STRtree([d[1] for d in districts])

    print("Fetching places...")
    places = overpass("places", f'[out:json][timeout:300];{AREA}nwr(area.pb)["place"~"^(village|hamlet|town|city|suburb|neighbourhood)$"]["name"];out center;')
    seen = set()
    pts, props = [], []
    for el in places["elements"]:
        if "center" in el:
            el.update(lon=el["center"]["lon"], lat=el["center"]["lat"])
        key = (round(el["lon"], 4), round(el["lat"], 4))
        if key in seen:
            continue
        p = Point(el["lon"], el["lat"])
        if not outline.contains(p):
            continue
        seen.add(key)
        t = el["tags"]
        district = ""
        for i in dist_tree.query(p, predicate="within"):
            district = districts[i][0]
            break
        pts.append(p)
        props.append({
            "name": t.get("name:en") or t["name"],
            "pa": t.get("name:pa", ""),
            "kind": t["place"],
            "district": district,
        })
    print(f"  {len(pts)} places")

    print("Building Voronoi cells...")
    cells = voronoi_polygons(MultiPoint(pts), extend_to=outline.envelope.buffer(0.5))
    cell_tree = STRtree(list(cells.geoms))
    features = []
    for i, p in enumerate(pts):
        idx = cell_tree.query(p, predicate="intersects")
        cell = next(cells.geoms[j] for j in idx if cells.geoms[j].contains(p))
        geom = cell.intersection(outline)
        if geom.is_empty:
            continue
        geom = geom.simplify(0.0002)
        features.append({
            "type": "Feature",
            "properties": {"id": i, **props[i], "lat": round(p.y, 5), "lng": round(p.x, 5)},
            "geometry": mapping(geom),
        })

    def rounded(obj):
        return json.loads(json.dumps(obj), parse_float=lambda f: round(float(f), 4))

    (DATA / "punjab_pinds.json").write_text(
        json.dumps(rounded({"type": "FeatureCollection", "features": features}), separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    (DATA / "punjab_outline.json").write_text(
        json.dumps(rounded({"type": "Feature", "properties": {}, "geometry": mapping(outline)}), separators=(",", ":")),
        encoding="utf-8",
    )
    size = (DATA / "punjab_pinds.json").stat().st_size / 1e6
    print(f"Done: {len(features)} pinds, {size:.1f} MB")


if __name__ == "__main__":
    main()
