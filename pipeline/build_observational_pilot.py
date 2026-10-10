"""Build a coarse, observational Berlin species pack from public GBIF API records."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
import ssl
import sys
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import h3
import certifi

DATASET_KEY = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"
DATASET_DOI = "https://doi.org/10.15468/ab3s5x"
DATASET_TITLE = "iNaturalist Research-grade Observations"
API = "https://api.gbif.org/v1/occurrence/search"
SPECIES_API = "https://api.gbif.org/v1/species"
BERLIN_POLYGON = (
    "POLYGON ((13.088 52.338, 13.762 52.338, 13.762 52.675, "
    "13.088 52.675, 13.088 52.338))"
)
LICENSES = ("CC0_1_0", "CC_BY_4_0")
GRID_RESOLUTION = 6
MIN_TAXON_RECORDS = 30
MIN_TAXON_CELLS = 5
MIN_TAXON_YEARS = 3
MAX_UNCERTAINTY_METRES = 1_000
PAGE_SIZE = 300
MONTH_NAMES = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
GROUPS = {
    "Bird": {"Aves"},
    "Mammal": {"Mammalia"},
    "Herpetofauna": {"Amphibia", "Reptilia"},
    "Plant": {"Plantae"},
    "Fungi": {"Fungi"},
    "Invertebrate": {"Insecta", "Arachnida", "Malacostraca", "Chilopoda", "Diplopoda"},
}
EMOJI = {
    "Bird": "🐦", "Mammal": "🐾", "Herpetofauna": "🦎",
    "Plant": "🌿", "Fungi": "🍄", "Invertebrate": "🐞",
}
FIELDCRAFT = {
    "Bird": {
        "en": "Listen and watch from a distance; do not approach nests or feed wildlife.",
        "de": "Höre und beobachte aus Abstand. Nähere dich keinen Nestern und füttere keine Wildtiere.",
        "fr": "Écoute et observe à distance ; n’approche pas les nids et ne nourris pas les animaux.",
    },
    "Mammal": {
        "en": "Look quietly for the animal or its signs; never follow or feed wildlife.",
        "de": "Achte leise auf das Tier oder seine Spuren. Verfolge und füttere keine Wildtiere.",
        "fr": "Cherche discrètement l’animal ou ses traces ; ne le suis pas et ne le nourris pas.",
    },
    "Herpetofauna": {
        "en": "Observe from the path without touching or moving the animal.",
        "de": "Beobachte vom Weg aus, ohne das Tier zu berühren oder umzusetzen.",
        "fr": "Observe depuis le chemin sans toucher ni déplacer l’animal.",
    },
    "Plant": {
        "en": "Compare leaf shape, flowers, or seed heads; leave the plant in place.",
        "de": "Vergleiche Blattform, Blüten oder Samenstände und lass die Pflanze stehen.",
        "fr": "Compare la forme des feuilles, les fleurs ou les graines sans cueillir la plante.",
    },
    "Fungi": {
        "en": "Notice its shape and surroundings from the path; never pick or eat wild fungi.",
        "de": "Achte vom Weg aus auf Form und Umgebung. Pflücke oder iss keine Wildpilze.",
        "fr": "Observe sa forme et son milieu depuis le chemin ; ne cueille ni ne mange de champignons.",
    },
    "Invertebrate": {
        "en": "Watch without touching, collecting, or disturbing the animal.",
        "de": "Beobachte das Tier, ohne es zu berühren, zu sammeln oder zu stören.",
        "fr": "Observe sans toucher, capturer ni déranger l’animal.",
    },
}


def _query_page(start: date, end: date, offset: int) -> dict[str, Any]:
    params = [
        ("datasetKey", DATASET_KEY),
        ("geometry", BERLIN_POLYGON),
        ("hasCoordinate", "true"),
        ("basisOfRecord", "HUMAN_OBSERVATION"),
        ("occurrenceStatus", "PRESENT"),
        ("eventDate", f"{start.isoformat()},{end.isoformat()}"),
        ("license", LICENSES[0]),
        ("license", LICENSES[1]),
        ("limit", str(PAGE_SIZE)),
        ("offset", str(offset)),
    ]
    request = Request(
        f"{API}?{urlencode(params)}",
        headers={"Accept": "application/json", "User-Agent": "DailyDoseOfNature observational pilot"},
    )
    for attempt in range(5):
        try:
            with urlopen(
                request,
                timeout=45,
                context=ssl.create_default_context(cafile=certifi.where()),
            ) as response:
                return json.loads(response.read())
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 4:
                raise
            time.sleep(min(2**attempt, 16))
        except (TimeoutError, URLError):
            if attempt == 4:
                raise
            time.sleep(min(2**attempt, 16))
    raise RuntimeError("GBIF request retries exhausted.")


def _query_vernacular_names(taxon_key: int) -> list[dict[str, Any]]:
    request = Request(
        f"{SPECIES_API}/{taxon_key}/vernacularNames",
        headers={"Accept": "application/json", "User-Agent": "DailyDoseOfNature observational pilot"},
    )
    for attempt in range(5):
        try:
            with urlopen(
                request,
                timeout=30,
                context=ssl.create_default_context(cafile=certifi.where()),
            ) as response:
                return json.loads(response.read()).get("results", [])
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 4:
                raise
            time.sleep(min(2**attempt, 16))
        except (TimeoutError, URLError):
            if attempt == 4:
                raise
            time.sleep(min(2**attempt, 16))
    raise RuntimeError(f"GBIF vernacular-name request retries exhausted for taxon {taxon_key}.")


def common_names_from_vernacular_rows(
    rows: list[dict[str, Any]],
    scientific_name: str,
) -> dict[str, str]:
    language_codes = {"en": {"en", "eng"}, "de": {"de", "deu"}, "fr": {"fr", "fra"}}
    available: dict[str, list[str]] = {language: [] for language in language_codes}
    for row in rows:
        common_name = str(row.get("vernacularName") or "").strip()
        language = str(row.get("language") or "").strip().casefold().split("-")[0]
        if not common_name or common_name.casefold() == scientific_name.casefold():
            continue
        for locale, codes in language_codes.items():
            if language in codes:
                available[locale].append(common_name)
    return {locale: names[0] for locale, names in available.items() if names}


def names_from_vernacular_rows(
    rows: list[dict[str, Any]],
    scientific_name: str,
) -> dict[str, str]:
    common_names = common_names_from_vernacular_rows(rows, scientific_name)
    fallback = next(iter(common_names.values()), scientific_name)
    return {
        locale: common_names.get(locale, common_names.get("en", fallback))
        for locale in ("en", "de", "fr")
    }


def populate_common_names(species: list[dict[str, Any]]) -> tuple[int, list[int]]:
    """Fetch localized GBIF vernacular names; report taxa where lookup failed."""
    taxon_keys = {
        int(item["id"].removeprefix("gbif-")): item
        for item in species
        if str(item.get("id", "")).startswith("gbif-")
    }
    failures: list[int] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=6) as executor:
        requests = {executor.submit(_query_vernacular_names, key): key for key in taxon_keys}
        for future in as_completed(requests):
            key = requests[future]
            item = taxon_keys[key]
            try:
                rows = future.result()
            except (HTTPError, TimeoutError, URLError, ValueError) as error:
                failures.append(key)
                print(f"Common-name lookup failed for GBIF taxon {key}: {error}", file=sys.stderr)
                continue
            item["common_names"] = common_names_from_vernacular_rows(rows, item["scientific_name"])
            item["names"] = names_from_vernacular_rows(rows, item["scientific_name"])
            completed += 1
    return completed, sorted(failures)


def fetch_records(today: date | None = None) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Fetch each calendar year separately to stay below GBIF's 100,000 offset limit."""
    current = today or date.today()
    records: dict[int, dict[str, Any]] = {}
    yearly_counts: dict[str, int] = {}
    for year in range(2023, current.year + 1):
        start = date(year, 1, 1)
        end = min(date(year, 12, 31), current)
        offset = 0
        while True:
            page = _query_page(start, end, offset)
            yearly_counts[str(year)] = int(page["count"])
            results = page.get("results", [])
            if not results:
                break
            for record in results:
                if isinstance(record.get("key"), int):
                    records[record["key"]] = record
            offset += len(results)
            if page.get("endOfRecords") or offset >= int(page["count"]):
                break
            time.sleep(0.15)
    return list(records.values()), yearly_counts


def _taxon_group(record: dict[str, Any]) -> str | None:
    kingdom = str(record.get("kingdom", "")).casefold()
    taxon_class = str(record.get("class", ""))
    if kingdom == "plantae":
        return "Plant"
    if kingdom == "fungi":
        return "Fungi"
    for group, classes in GROUPS.items():
        if taxon_class in classes:
            return group
    return None


def _redistribution_license(value: Any) -> str | None:
    license_value = str(value or "").strip().casefold()
    if license_value in {"cc0_1_0", "cc0"} or "publicdomain/zero/1.0" in license_value:
        return "CC0_1_0"
    if license_value == "cc_by_4_0" or (
        "creativecommons.org/licenses/by/4.0" in license_value
        and "by-nc" not in license_value
        and "by-sa" not in license_value
    ):
        return "CC_BY_4_0"
    return None


def _is_threatened(record: dict[str, Any]) -> bool:
    classifications = record.get("classifications", {})
    if not isinstance(classifications, dict):
        return False
    pending = [classifications]
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            category = value.get("iucnRedListCategoryCode")
            if category in {"VU", "EN", "CR"}:
                return True
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
    return False


def _parse_month(record: dict[str, Any]) -> int | None:
    try:
        return date.fromisoformat(str(record.get("eventDate", ""))[:10]).month
    except ValueError:
        return None


def build_pack(
    records: list[dict[str, Any]],
    yearly_counts: dict[str, int],
    built_at: datetime | None = None,
) -> dict[str, Any]:
    drops: Counter[str] = Counter()
    aggregates: dict[int, dict[str, Any]] = {}
    all_cells: Counter[str] = Counter()
    all_months: Counter[int] = Counter()
    all_records = 0

    for record in records:
        if record.get("datasetKey") != DATASET_KEY:
            drops["wrong_dataset"] += 1
            continue
        license_name = _redistribution_license(record.get("license"))
        if license_name is None:
            drops["license"] += 1
            continue
        if record.get("basisOfRecord") != "HUMAN_OBSERVATION":
            drops["basis_of_record"] += 1
            continue
        if _is_threatened(record):
            drops["threatened_taxon"] += 1
            continue
        group = _taxon_group(record)
        if group is None:
            drops["unsupported_taxon_group"] += 1
            continue
        species_key = record.get("speciesKey")
        try:
            species_key = int(species_key)
            latitude = float(record["decimalLatitude"])
            longitude = float(record["decimalLongitude"])
            uncertainty = float(record["coordinateUncertaintyInMeters"])
            year = int(str(record.get("eventDate", ""))[:4])
            month = _parse_month(record)
        except (KeyError, TypeError, ValueError):
            drops["missing_or_invalid_fields"] += 1
            continue
        if month is None or not (2023 <= year <= date.today().year):
            drops["invalid_date"] += 1
            continue
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            drops["invalid_coordinates"] += 1
            continue
        if not math.isfinite(uncertainty) or not (0 < uncertainty <= MAX_UNCERTAINTY_METRES):
            drops["uncertain_coordinates"] += 1
            continue
        cell = h3.latlng_to_cell(latitude, longitude, GRID_RESOLUTION)
        item = aggregates.setdefault(species_key, {
            "group": group,
            "scientific_name": str(record.get("species") or record.get("acceptedScientificName") or species_key),
            "counts_by_cell": Counter(),
            "counts_by_month": Counter(),
            "years": set(),
            "licenses": set(),
        })
        if item["group"] != group:
            drops["conflicting_taxonomy"] += 1
            continue
        item["counts_by_cell"][cell] += 1
        item["counts_by_month"][month] += 1
        item["years"].add(year)
        item["licenses"].add(license_name)
        all_cells[cell] += 1
        all_months[month] += 1
        all_records += 1

    candidates = {
        key: value for key, value in aggregates.items()
        if sum(value["counts_by_cell"].values()) >= MIN_TAXON_RECORDS
        and len(value["counts_by_cell"]) >= MIN_TAXON_CELLS
        and len(value["years"]) >= MIN_TAXON_YEARS
    }
    names_count = max(len(candidates), 1)
    published = []
    for taxon_key, item in candidates.items():
        count = sum(item["counts_by_cell"].values())
        baseline = (count + 1) / (all_records + names_count)
        month_counts = item["counts_by_month"]
        month_lifts = {
            MONTH_NAMES[month - 1]: round(max(0.25, min(4.0, (
                ((month_counts[month] + 1) / (all_months[month] + names_count))
                / max(baseline, 1e-9)
            ))), 4)
            for month in range(1, 13)
        }
        cell_rates = {}
        for cell, support in item["counts_by_cell"].items():
            effort = all_cells[cell]
            if support < 3:
                continue
            cell_rates[cell] = {
                "rate": round((support + baseline * 2) / (effort + 2), 6),
                "support": support,
                "effort": effort,
                "low_effort": effort < 100,
                "parent_rate": round((support + baseline * 2) / (effort + 2), 6),
            }
        months = [month for month in range(1, 13) if month_counts[month] > 0]
        name = item["scientific_name"]
        published.append({
            "id": f"gbif-{taxon_key}",
            "group": item["group"],
            "emoji": EMOJI[item["group"]],
            "names": {"en": name, "de": name, "fr": name},
            "scientific_name": name,
            "months": months,
            "habitats": [],
            "fieldcraft": FIELDCRAFT[item["group"]],
            "month_lifts": month_lifts,
            "cell_rates": cell_rates,
            "baseline_rate": round(baseline, 6),
            "observation_count": count,
            "distinct_years": len(item["years"]),
            "licenses": sorted(item["licenses"]),
        })
    published.sort(key=lambda item: (-item["observation_count"], item["scientific_name"]))
    if not published:
        raise ValueError("No taxa passed the minimum support, spatial spread, and multi-year safety thresholds.")

    build_time = built_at or datetime.now(timezone.utc)
    accepted_record_count = sum(sum(item["counts_by_cell"].values()) for item in aggregates.values())
    return {
        "schemaVersion": 2,
        "status": "observational-pilot",
        "builtAt": build_time.isoformat(),
        "source": {
            "datasetKey": DATASET_KEY,
            "title": DATASET_TITLE,
            "doi": DATASET_DOI,
            "queryUrl": API,
            "observedFrom": "2023-01-01",
            "observedTo": date.today().isoformat(),
            "licenses": list(LICENSES),
            "gridResolution": GRID_RESOLUTION,
            "rawQueryCountsByYear": yearly_counts,
            "acceptedRecordCount": accepted_record_count,
            "droppedRecordCount": sum(drops.values()),
            "dropReasons": dict(sorted(drops.items())),
        },
        "quality": {
            "minimumTaxonRecords": MIN_TAXON_RECORDS,
            "minimumDistinctCells": MIN_TAXON_CELLS,
            "minimumDistinctYears": MIN_TAXON_YEARS,
            "maximumCoordinateUncertaintyMetres": MAX_UNCERTAINTY_METRES,
            "publishedTaxa": len(published),
        },
        "species": published,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("public/data/berlin-pack.json"))
    parser.add_argument(
        "--names-only",
        action="store_true",
        help="Refresh common names in the existing pack without re-fetching occurrence records.",
    )
    args = parser.parse_args()
    if args.names_only:
        pack = json.loads(args.output.read_text(encoding="utf-8"))
    else:
        records, yearly_counts = fetch_records()
        pack = build_pack(records, yearly_counts)
    updated_names, name_failures = populate_common_names(pack["species"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(pack['species'])} widely observed taxa from "
        f"{pack['source']['acceptedRecordCount']} filtered GBIF records to {args.output}; "
        f"refreshed common names for {updated_names} taxa."
    )
    if name_failures:
        print(
            f"Warning: GBIF common names could not be refreshed for {len(name_failures)} taxa; "
            "those taxa retain their scientific-name fallback.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
