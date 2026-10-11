"""Copy credited species photos with licenses that permit non-commercial sharing."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path


LICENSES = {
    "cc0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
    "pd": ("Public domain", None),
    "cc-by": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "cc-by-sa": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "cc-by-sa-3.0": ("CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/"),
    "cc-by-nc": ("CC BY-NC 4.0", "https://creativecommons.org/licenses/by-nc/4.0/"),
    "cc-by-nc-sa": ("CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/"),
    "cc-by-nc-nd": ("CC BY-NC-ND 4.0", "https://creativecommons.org/licenses/by-nc-nd/4.0/"),
}


def collect_credited_images(image_dir: Path, credits_file: Path) -> list[dict[str, str | None]]:
    entries: list[dict[str, str | None]] = []
    seen: set[str] = set()
    with credits_file.open(encoding="utf-8", newline="") as stream:
        for row_number, row in enumerate(csv.reader(stream, delimiter="\t"), start=1):
            if len(row) != 3:
                continue
            scientific_name, attribution, license_code = (value.strip() for value in row)
            image_name = scientific_name.replace(" ", "_") + ".jpg"
            if not (image_dir / image_name).is_file():
                continue
            if scientific_name in seen:
                raise ValueError(f"Duplicate image credit for {scientific_name} on row {row_number}.")
            seen.add(scientific_name)
            license_details = LICENSES.get(license_code.casefold())
            if not license_details or not attribution:
                continue
            license_name, license_url = license_details
            entries.append({
                "scientificName": scientific_name,
                "image": f"/images/{image_name}",
                "attribution": attribution,
                "license": license_name,
                "licenseUrl": license_url,
            })
    return entries


def prepare_species_images(root: Path) -> list[dict[str, str | None]]:
    image_dir = root / "images"
    entries = collect_credited_images(image_dir, root / "credits.tsv")
    public_images = root / "public" / "images"
    public_images.mkdir(parents=True, exist_ok=True)

    for entry in entries:
        image_name = Path(str(entry["image"])).name
        shutil.copy2(image_dir / image_name, public_images / image_name)

    credits_output = root / "src" / "speciesImageCredits.json"
    credits_output.write_text(json.dumps(
        {entry["scientificName"]: entry for entry in entries},
        ensure_ascii=False,
        indent=2,
    ) + "\n", encoding="utf-8")
    return entries


if __name__ == "__main__":
    project_root = Path(__file__).resolve().parents[1]
    prepared = prepare_species_images(project_root)
    print(f"Prepared {len(prepared)} attributed species images for non-commercial use.")
