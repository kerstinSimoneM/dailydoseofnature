"""Build src/osmAnchors.json: named public green and water places in Berlin from OpenStreetMap.

Data (c) OpenStreetMap contributors, ODbL. Usage: python pipeline/build_osm_anchors.py [saved-overpass-response.json]
"""
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BBOX = "52.40,13.20,52.62,13.62"
QUERY = f"""[out:json][timeout:90];(
way["leisure"~"^(park|garden|nature_reserve)$"]["name"]({BBOX});
way["natural"="water"]["name"]({BBOX});
way["landuse"="forest"]["name"]({BBOX});
);out center tags;"""
MIN_SPACING_KM = 0.55
OUT = Path(__file__).resolve().parents[1] / "src" / "osmAnchors.json"
EXISTING = [(52.5228, 13.4092), (52.5145, 13.3501), (52.5274, 13.4324), (52.4875, 13.4692),
            (52.4857, 13.4157), (52.4731, 13.4032), (52.5203, 13.4062)]


def classify(tags):
    if tags.get("leisure") == "nature_reserve":
        return 0, "nature reserve with wild edges & mature trees"
    if tags.get("leisure") == "park":
        return 1, "park paths, lawns & mature trees"
    if tags.get("leisure") == "garden":
        return 2, "planted garden beds & hedges"
    if tags.get("landuse") == "forest":
        return 3, "woodland paths & tall trees"
    return 4, "waterside path & planted edges with water nearby"


def km(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def main():
    if len(sys.argv) > 1:
        elements = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["elements"]
        return write(elements)
    request = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": QUERY}).encode(),
        headers={"User-Agent": "TouchGrassBerlin/1.0 (open-source hackathon project)", "Accept": "*/*"},
    )
    write(json.load(urllib.request.urlopen(request, timeout=150))["elements"])


def write(elements):
    candidates = []
    for element in elements:
        tags = element.get("tags", {})
        center = element.get("center")
        name = tags.get("name", "").strip()
        if not center or not name or tags.get("access") in {"private", "no"} or tags.get("fee") == "yes":
            continue
        rank, habitat = classify(tags)
        candidates.append((rank, name, center["lat"], center["lon"], habitat))
    candidates.sort(key=lambda item: (item[0], item[1]))
    chosen, points, names = [], list(EXISTING), set()
    for rank, name, lat, lng, habitat in candidates:
        if name in names or any(km((lat, lng), point) < MIN_SPACING_KM for point in points):
            continue
        names.add(name)
        points.append((lat, lng))
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "place"
        chosen.append({"id": f"osm-{slug}-{len(chosen)}", "name": name, "lat": round(lat, 5),
                       "lng": round(lng, 5), "habitat": habitat, "lit": False, "access": "public"})
    OUT.write_text(json.dumps(chosen, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(chosen)} places to {OUT}")


if __name__ == "__main__":
    main()
