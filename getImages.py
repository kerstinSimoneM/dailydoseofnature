import requests, time, pathlib

out = pathlib.Path("images"); out.mkdir(exist_ok=True)
credits, missing = [], []

for name in pathlib.Path("species.txt").read_text().split("\n"):
    name = name.strip()
    if not name:
        continue
    r = requests.get("https://api.inaturalist.org/v1/taxa",
                     params={"q": name, "rank": "species", "per_page": 5}).json()
    # exact scientific-name match only, to avoid wrong taxa
    hit = next((t for t in r["results"] if t["name"].lower() == name.lower()), None)
    photo = hit and hit.get("default_photo")
    if not photo:
        missing.append(name); continue
    url = photo["medium_url"].replace("/medium.", "/large.")  # or "/original."
    img = requests.get(url)
    (out / f"{name.replace(' ', '_')}.jpg").write_bytes(img.content)
    credits.append(f"{name}\t{photo.get('attribution')}\t{photo.get('license_code')}")
    time.sleep(1)  # be polite to the API

pathlib.Path("credits.tsv").write_text("\n".join(credits))
pathlib.Path("missing.txt").write_text("\n".join(missing))