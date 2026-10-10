"""Build a location-private Berlin wildlife pack from local, licensed release inputs.

The pipeline deliberately accepts GBIF's downloaded occurrence archive rather than
querying the occurrence API. It will not issue a user-location request or publish an
uncalibrated candidate pack.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import io
import json
import math
import random
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import h3
import yaml
from astral import Observer
from astral.sun import sun
from shapely.geometry import Point, shape
from shapely.ops import nearest_points

from .effort import shrunk_lifts
from .weather import weather_bucket

BERLIN_TZ = ZoneInfo("Europe/Berlin")
GROUP_QUOTAS = {
    "Bird": 55,
    "Mammal": 12,
    "Herpetofauna": 8,
    "Invertebrate": 20,
    "Plant": 55,
    "Other": 10,
}
BAD_MEANS = {"MANAGED", "CULTIVATED", "INTRODUCED_MANAGED", "INTRODUCED_CULTIVATED"}
CULTIVATION_MARKERS = ("captive", "cultivated", "zoo", "garden escape", "planted")
MONTH_NAMES = {
    1: "january", 2: "february", 3: "march", 4: "april", 5: "may", 6: "june",
    7: "july", 8: "august", 9: "september", 10: "october", 11: "november", 12: "december",
}
SEASONS = {
    "spring": {3, 4, 5},
    "summer": {6, 7, 8},
    "autumn": {9, 10, 11},
    "winter": {12, 1, 2},
}


@dataclass(frozen=True)
class Observation:
    taxon_key: int
    group: str
    latitude: float
    longitude: float
    cell: str
    parent: str
    observed_at: datetime | None
    month: int
    time_bucket: str
    weather_bucket: str
    license: str
    gbif_id: str
    image: dict[str, str] | None
    scientific_name: str
    vernacular_names: dict[str, str]


def read_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a YAML object.")
    return value


def verify_download_citation(archive_path: Path, doi: str | None = None) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        citation_member = next(
            (name for name in archive.namelist() if Path(name).name.casefold() == "citation.txt"),
            None,
        )
        if citation_member is None:
            raise ValueError(f"{archive_path} is missing GBIF citation.txt; verify it is an official GBIF download.")
        citation = archive.read(citation_member).decode("utf-8-sig")
    if "https://doi.org/" not in citation.casefold():
        raise ValueError(f"{archive_path} citation.txt does not contain a GBIF download DOI.")
    if doi and doi.rstrip("/") not in citation:
        raise ValueError("The supplied training DOI does not match citation.txt in the training archive.")


def configured_dataset_key(sources_path: Path) -> str:
    source = read_yaml(sources_path)
    observations = source.get("observations")
    key = observations.get("dataset_key") if isinstance(observations, dict) else None
    if not isinstance(key, str) or not re.fullmatch(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        key.strip(),
    ):
        raise ValueError(f"{sources_path}: configure observations.dataset_key with the verified GBIF dataset UUID.")
    return key.strip().lower()


def configured_max_age_years(sources_path: Path) -> float:
    source = read_yaml(sources_path)
    observations = source.get("observations")
    value = observations.get("max_age_years") if isinstance(observations, dict) else None
    try:
        years = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{sources_path}: observations.max_age_years must be a positive number.") from error
    if not math.isfinite(years) or years <= 0:
        raise ValueError(f"{sources_path}: observations.max_age_years must be a positive number.")
    return years


def configured_max_uncertainty_m(sources_path: Path) -> float:
    source = read_yaml(sources_path)
    observations = source.get("observations")
    value = observations.get("max_coordinate_uncertainty_m") if isinstance(observations, dict) else None
    try:
        metres = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(
            f"{sources_path}: observations.max_coordinate_uncertainty_m must be a positive number."
        ) from error
    if not math.isfinite(metres) or metres <= 0:
        raise ValueError(
            f"{sources_path}: observations.max_coordinate_uncertainty_m must be a positive number."
        )
    return metres


def validate_temporal_holdout(training: list[Observation], held_out: list[Observation]) -> None:
    training_dates = [item.observed_at.date() for item in training if item.observed_at]
    held_out_dates = [item.observed_at.date() for item in held_out if item.observed_at]
    if not training_dates or not held_out_dates:
        raise ValueError("Training and held-out archives both need dated observations.")
    if min(held_out_dates) <= max(training_dates):
        raise ValueError("Held-out observations must occur strictly after the latest training observation.")
    if max(held_out_dates) > max(training_dates) + timedelta(days=60):
        raise ValueError("Held-out observations must fall within the 60 days after the training window.")
    if (max(held_out_dates) - min(held_out_dates)).days >= 60:
        raise ValueError("Held-out observations span more than the required 60-day test window.")


def read_geojson(path: Path) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a GeoJSON object.")
    if value.get("type") == "FeatureCollection":
        features = value.get("features", [])
    elif value.get("type") == "Feature":
        features = [value]
    else:
        features = [{"type": "Feature", "geometry": value, "properties": {}}]
    if not isinstance(features, list) or any(not isinstance(feature, dict) for feature in features):
        raise ValueError(f"{path} has no GeoJSON features.")
    return features


def get_berlin_polygon(path: Path):
    polygons = [
        shape(feature["geometry"])
        for feature in read_geojson(path)
        if feature.get("geometry") and shape(feature["geometry"]).geom_type in {"Polygon", "MultiPolygon"}
    ]
    if not polygons:
        raise ValueError("Berlin boundary GeoJSON must contain a polygon.")
    from shapely.ops import unary_union

    boundary = unary_union(polygons)
    if not boundary.is_valid:
        boundary = boundary.buffer(0)
    if boundary.is_empty or boundary.area <= 0:
        raise ValueError("Berlin boundary polygon is invalid or empty.")
    return boundary


def parse_event_date(event_date: str, event_time: str = "") -> datetime | None:
    raw = (event_date or "").strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed = datetime.combine(date.fromisoformat(raw[:10]), time.min)
        except ValueError:
            return None
    if event_time.strip() and parsed.time() == time.min:
        try:
            parsed = datetime.combine(parsed.date(), time.fromisoformat(event_time.strip()))
        except ValueError:
            pass
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=BERLIN_TZ)
    return parsed.astimezone(BERLIN_TZ)


def time_bucket(observed_at: datetime | None, latitude: float, longitude: float) -> str:
    if observed_at is None or observed_at.hour in {0, 12} and observed_at.minute == 0 and observed_at.second == 0:
        return "unknown"
    try:
        solar = sun(Observer(latitude, longitude), date=observed_at.date(), tzinfo=BERLIN_TZ)
    except ValueError:
        return "night"
    minute = observed_at.hour * 60 + observed_at.minute
    rise = solar["sunrise"].hour * 60 + solar["sunrise"].minute
    set_ = solar["sunset"].hour * 60 + solar["sunset"].minute
    if rise - 45 <= minute < rise + 120:
        return "dawn"
    if rise + 120 <= minute < 13 * 60:
        return "late_morning"
    if 13 * 60 <= minute < set_ - 90:
        return "afternoon"
    if set_ - 90 <= minute < set_ + 60:
        return "dusk"
    return "night"


class WeatherArchive:
    def __init__(self, path: Path):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Historical weather archive must be a JSON object.")
        try:
            latitude = float(payload.get("latitude", math.nan))
            longitude = float(payload.get("longitude", math.nan))
        except (TypeError, ValueError) as error:
            raise ValueError("Historical weather archive must include numeric Berlin-centre coordinates.") from error
        if not math.isclose(latitude, 52.520, abs_tol=0.02) or not math.isclose(longitude, 13.405, abs_tol=0.02):
            raise ValueError("Historical weather archive must use the fixed Berlin centre (52.520, 13.405).")
        hourly = payload.get("hourly", {})
        if not isinstance(hourly, dict):
            raise ValueError("Open-Meteo archive hourly data must be a JSON object.")
        fields = (
            "time", "temperature_2m", "precipitation", "snowfall",
            "weather_code", "cloud_cover",
        )
        if any(field not in hourly for field in fields):
            raise ValueError("Open-Meteo archive is missing a required hourly field.")
        lengths = {len(hourly[field]) for field in fields}
        if len(lengths) != 1:
            raise ValueError("Open-Meteo archive hourly fields have different lengths.")
        self.values: list[tuple[datetime, dict[str, float]]] = []
        for index, raw_time in enumerate(hourly["time"]):
            if not isinstance(raw_time, str):
                raise ValueError(f"Open-Meteo archive has an invalid hourly timestamp at index {index}.")
            try:
                instant = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                temperature = float(hourly["temperature_2m"][index])
                precipitation = float(hourly["precipitation"][index])
                snowfall = float(hourly["snowfall"][index])
                weather_code = float(hourly["weather_code"][index])
                cloud_cover = float(hourly["cloud_cover"][index])
            except (TypeError, ValueError) as error:
                raise ValueError(f"Open-Meteo archive has invalid hourly values at index {index}.") from error
            values = (temperature, precipitation, snowfall, weather_code, cloud_cover)
            if not all(math.isfinite(value) for value in values) or not weather_code.is_integer():
                raise ValueError(f"Open-Meteo archive has invalid hourly values at index {index}.")
            if instant.tzinfo is None:
                instant = instant.replace(tzinfo=BERLIN_TZ)
            self.values.append((instant.astimezone(timezone.utc), {
                "temperature_c": temperature,
                "precipitation_mm": precipitation,
                "snowfall_mm": snowfall,
                "weather_code": weather_code,
                "cloud_cover_pct": cloud_cover,
            }))
        self.times = [item[0] for item in self.values]
        if any(left > right for left, right in zip(self.times, self.times[1:])):
            raise ValueError("Open-Meteo archive hourly timestamps must be chronological.")

    def classify(self, observed_at: datetime | None) -> str:
        if observed_at is None or not self.values:
            return "unknown"
        instant = observed_at.astimezone(timezone.utc)
        insertion = bisect.bisect_left(self.times, instant)
        candidates = [index for index in (insertion - 1, insertion) if 0 <= index < len(self.times)]
        index = min(candidates, key=lambda item: abs((self.times[item] - instant).total_seconds()))
        if abs((self.times[index] - instant).total_seconds()) > 3 * 60 * 60:
            return "unknown"
        current = self.values[index][1]
        previous_precipitation = sum(
            item[1]["precipitation_mm"] for item in self.values[max(0, index - 3):index + 1]
        )
        return weather_bucket(
            temperature_c=current["temperature_c"],
            precipitation_mm=max(current["precipitation_mm"], previous_precipitation),
            snowfall_mm=current["snowfall_mm"],
            weather_code=int(current["weather_code"]),
            cloud_cover_pct=current["cloud_cover_pct"],
        )


def taxon_group(row: dict[str, str]) -> str | None:
    klass = (row.get("class") or "").casefold()
    if klass in {"bryopsida", "marchantiopsida", "lichenes", "agaricomycetes", "pezizomycetes"}:
        return "Other"
    if klass == "aves":
        return "Bird"
    if klass == "mammalia":
        return "Mammal"
    if klass in {"amphibia", "reptilia"}:
        return "Herpetofauna"
    if klass in {"insecta", "arachnida", "malacostraca", "chilopoda", "diplopoda", "gastropoda"}:
        return "Invertebrate"
    kingdom = (row.get("kingdom") or "").casefold()
    if kingdom in {"plantae", "viridiplantae"}:
        return "Plant"
    if kingdom in {"fungi", "mycota"}:
        return "Other"
    return None


def as_bool(value: str) -> bool:
    return (value or "").strip().casefold() in {"true", "1", "yes"}


def is_private_or_generalized(row: dict[str, str]) -> bool:
    withheld = " ".join(row.get(name, "") for name in ("informationWithheld", "dataGeneralizations")).casefold()
    markers = ("obscur", "generaliz", "private", "withheld", "sensitive")
    return any(marker in withheld for marker in markers)


def clean_record(row: dict[str, str], boundary, max_uncertainty: float = 100) -> tuple[bool, str]:
    if (row.get("occurrenceStatus") or "PRESENT").upper() != "PRESENT":
        return False, "not_present"
    if as_bool(row.get("hasGeospatialIssues", "")):
        return False, "geospatial_issue"
    if is_private_or_generalized(row):
        return False, "generalized_or_private"
    means = (row.get("establishmentMeans") or "").upper().replace(" ", "_")
    if means in BAD_MEANS:
        return False, "cultivated_or_managed"
    remarks = " ".join((row.get(field) or "") for field in ("occurrenceRemarks", "verbatimRemarks")).casefold()
    if any(marker in remarks for marker in CULTIVATION_MARKERS):
        return False, "captive_or_cultivated"
    basis = (row.get("basisOfRecord") or "").casefold()
    if any(value in basis for value in ("machine_observation", "material_sample", "preserved_specimen", "fossil")):
        return False, "not_wild_observation"
    raw_uncertainty = row.get("coordinateUncertaintyInMeters", "")
    if not raw_uncertainty.strip():
        return False, "missing_coordinate_uncertainty"
    try:
        uncertainty = float(raw_uncertainty)
    except ValueError:
        return False, "invalid_uncertainty"
    if not math.isfinite(uncertainty) or uncertainty < 0:
        return False, "invalid_uncertainty"
    if uncertainty > max_uncertainty:
        return False, "uncertainty_over_limit"
    try:
        longitude, latitude = float(row["decimalLongitude"]), float(row["decimalLatitude"])
    except (ValueError, KeyError):
        return False, "invalid_coordinates"
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        return False, "invalid_coordinates"
    if not boundary.covers(Point(longitude, latitude)):
        return False, "outside_berlin"
    if not row.get("taxonKey", "").isdigit():
        return False, "missing_stable_taxon_key"
    return True, "accepted"


def read_dwca_tables(archive: Path) -> tuple[zipfile.ZipFile, str, str | None]:
    source = zipfile.ZipFile(archive)
    occurrence_name = next((name for name in source.namelist() if Path(name).name == "occurrence.txt"), None)
    multimedia_name = next((name for name in source.namelist() if Path(name).name == "multimedia.txt"), None)
    if occurrence_name is None:
        source.close()
        raise ValueError("The GBIF ZIP must contain occurrence.txt (a GBIF download archive).")
    return source, occurrence_name, multimedia_name


def multimedia_by_gbif_id(archive: zipfile.ZipFile, member: str | None) -> dict[str, dict[str, str]]:
    if not member:
        return {}
    results: dict[str, dict[str, str]] = {}
    with archive.open(member) as binary:
        reader = csv.DictReader(io.TextIOWrapper(binary, encoding="utf-8-sig"), delimiter="\t")
        for row in reader:
            identifier = (row.get("gbifID") or row.get("GBIFID") or "").strip()
            url = (row.get("identifier") or "").strip()
            license_url = (row.get("license") or "").strip()
            license_token = license_url.casefold().rstrip("/")
            redistributable = (
                license_token in {"cc0", "pdm"}
                or license_token.endswith("/publicdomain/zero/1.0")
                or license_token.endswith("/publicdomain/mark/1.0")
                or license_token.endswith("/licenses/by/4.0")
                or license_token.endswith("/licenses/by/3.0")
                or license_token.endswith("/licenses/by-sa/4.0")
                or license_token.endswith("/licenses/by-sa/3.0")
            )
            if identifier and url.startswith("https://") and redistributable:
                results.setdefault(identifier, {
                    "url": url,
                    "license": license_url,
                    "creator": (row.get("creator") or "").strip(),
                    "title": (row.get("title") or "").strip(),
                })
    return results


def occurrence_rows(archive_path: Path) -> Iterator[tuple[dict[str, str], dict[str, str] | None]]:
    archive, occurrence_member, multimedia_member = read_dwca_tables(archive_path)
    try:
        media = multimedia_by_gbif_id(archive, multimedia_member)
        with archive.open(occurrence_member) as binary:
            reader = csv.DictReader(io.TextIOWrapper(binary, encoding="utf-8-sig"), delimiter="\t")
            for row in reader:
                yield row, media.get((row.get("gbifID") or "").strip())
    finally:
        archive.close()


def green_anchors(osm_path: Path, boundary, resolution: int = 8) -> list[dict[str, Any]]:
    features = read_geojson(osm_path)
    green = []
    paths = []
    green_values = {"park", "forest", "wood", "nature_reserve", "cemetery", "riverbank", "meadow"}
    for feature in features:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        properties = feature.get("properties") or {}
        tags = properties.get("tags") if isinstance(properties.get("tags"), dict) else properties
        access = str(tags.get("access", "yes")).casefold()
        if access in {"private", "no", "customers", "permit", "restricted"} or str(tags.get("fee", "")).casefold() == "yes":
            continue
        geom = shape(geometry)
        highway = str(tags.get("highway", "")).casefold()
        if highway in {"footway", "path", "pedestrian", "track", "steps", "living_street", "residential"} and geom.geom_type in {"LineString", "MultiLineString"}:
            paths.append((geom, tags))
        green_value = next((str(tags[key]).casefold() for key in ("leisure", "landuse", "natural", "boundary") if str(tags.get(key, "")).casefold() in green_values), None)
        if green_value and geom.geom_type in {"Polygon", "MultiPolygon"} and geom.intersects(boundary):
            green.append((geom.intersection(boundary), tags, green_value))
    anchors = []
    path_index = None
    try:
        from shapely import STRtree

        path_geometries = [path[0] for path in paths]
        path_index = STRtree(path_geometries) if path_geometries else None
    except ImportError:
        path_geometries = [path[0] for path in paths]
    for area, tags, kind in green:
        if area.is_empty:
            continue
        candidate = area.representative_point()
        nearest_path: tuple[Any, dict[str, Any]] | None = None
        if paths:
            if path_index is not None:
                indexed = path_index.query(area, predicate="intersects")
                possible = [int(index) for index in indexed]
                candidate_paths = [paths[index] for index in possible]
            else:
                candidate_paths = [(path, path_tags) for path, path_tags in paths if area.intersects(path)]
            if candidate_paths:
                nearest_path = min(candidate_paths, key=lambda item: area.distance(item[0]))
        if nearest_path:
            candidate = nearest_points(area, nearest_path[0].intersection(area))[0]
            path_tags = nearest_path[1]
            lit = str(path_tags.get("lit", tags.get("lit", "no"))).casefold() in {"yes", "automatic"}
        else:
            path_tags = {}
            lit = False
        if not boundary.covers(candidate):
            continue
        osm_id = str(tags.get("@id") or tags.get("id") or f"anchor-{len(anchors) + 1}")
        cell = h3.latlng_to_cell(candidate.y, candidate.x, resolution)
        anchors.append({
            "id": osm_id,
            "name": str(tags.get("name") or f"{kind.replace('_', ' ').title()} green space"),
            "latitude": round(candidate.y, 6),
            "longitude": round(candidate.x, 6),
            "cell": cell,
            "parent": h3.cell_to_parent(cell, resolution - 1),
            "habitat_tags": {
                key: str(value) for key, value in tags.items()
                if key in {"leisure", "landuse", "natural", "boundary", "name"} and value
            },
            "lit": lit,
            "access": "public",
            "area_kind": kind,
            "osm_id": osm_id,
        })
    if not anchors:
        raise ValueError("No publicly accessible green anchor could be snapped to a walkable OSM path.")
    return anchors


def _month_key(month: int) -> str:
    return MONTH_NAMES[month]


def effort_lift_map(
    species_counts: Counter[str],
    all_counts: Counter[str],
    *,
    kappa: float = 10,
) -> dict[str, dict[str, float | int | bool]]:
    return shrunk_lifts(species_counts, all_counts, kappa=kappa)


def observation_timestamp(row: dict[str, str]) -> datetime | None:
    return parse_event_date(row.get("eventDate", ""), row.get("eventTime", ""))


def observations_from_archive(
    archive_path: Path,
    boundary,
    weather: WeatherArchive,
    sensitive_keys: set[int],
    identifiable_keys: set[int],
    expected_dataset_key: str,
    *,
    max_uncertainty: float = 100,
    max_age_years: float = 5,
) -> tuple[list[Observation], Counter[str], Counter[int], Counter[str]]:
    accepted: list[Observation] = []
    drops: Counter[str] = Counter()
    raw_clock: Counter[int] = Counter()
    sources: Counter[str] = Counter()
    for row, image in occurrence_rows(archive_path):
        if (row.get("datasetKey") or "").strip().casefold() != expected_dataset_key.casefold():
            raise ValueError(
                f"{archive_path} contains an occurrence without the configured GBIF datasetKey "
                f"{expected_dataset_key}."
            )
        raw_taxon_key = (row.get("taxonKey") or "").strip()
        if raw_taxon_key.isdigit() and int(raw_taxon_key) in sensitive_keys:
            drops["sensitive_from_species_records"] += 1
            continue
        timestamp = observation_timestamp(row)
        if timestamp and timestamp.date() < date.today() - timedelta(days=365.25 * max_age_years):
            drops["record_older_than_max_age"] += 1
            continue
        if timestamp:
            raw_clock[timestamp.hour] += 1
        valid, reason = clean_record(row, boundary, max_uncertainty)
        if not valid:
            drops[reason] += 1
            continue
        key = int(row["taxonKey"])
        group = taxon_group(row)
        # Spatial aggregation happens only after the curated sensitive-key check.
        latitude = float(row["decimalLatitude"])
        longitude = float(row["decimalLongitude"])
        cell = h3.latlng_to_cell(latitude, longitude, 8)
        parent = h3.cell_to_parent(cell, 7)
        sources[str(row.get("license") or "unknown")] += 1
        accepted.append(Observation(
            taxon_key=key,
            group=group or "Unclassified",
            latitude=latitude,
            longitude=longitude,
            cell=cell,
            parent=parent,
            observed_at=timestamp,
            month=timestamp.month if timestamp else 0,
            time_bucket=time_bucket(timestamp, latitude, longitude),
            weather_bucket=weather.classify(timestamp),
            license=(row.get("license") or "").strip(),
            gbif_id=(row.get("gbifID") or "").strip(),
            image=image if key in identifiable_keys else None,
            scientific_name=(row.get("scientificName") or "").strip(),
            vernacular_names=names_for(row),
        ))
    return accepted, drops, raw_clock, sources


def load_taxon_key_list(path: Path, key: str = "taxon_keys") -> set[int]:
    data = read_yaml(path)
    values = data.get(key, [])
    if not isinstance(values, list):
        raise ValueError(f"{path}: {key} must be a list of stable GBIF taxon keys.")
    keys = set()
    for value in values:
        try:
            keys.add(int(value))
        except (TypeError, ValueError) as error:
            raise ValueError(f"{path}: invalid GBIF taxon key {value!r}.") from error
    return keys


def names_for(row: dict[str, str]) -> dict[str, str]:
    vernacular = (row.get("vernacularName") or "").strip()
    language = (row.get("language") or "").strip().casefold().split("-")[0]
    scientific = (row.get("scientificName") or "").strip()
    names = {locale: scientific for locale in ("en", "de", "fr")}
    if vernacular and language in names:
        names[language] = vernacular
    elif vernacular:
        names["en"] = vernacular
    return names


def fieldcraft_for(group: str) -> dict[str, str]:
    tips = {
        "Bird": ("Listen and watch quietly from the path; never approach a nest.", "Höre und beobachte ruhig vom Weg aus; nähere dich niemals einem Nest.", "Écoute et observe calmement depuis le sentier ; n’approche jamais un nid."),
        "Plant": ("Notice leaf shapes and flowers without picking anything.", "Achte auf Blattformen und Blüten, ohne etwas zu pflücken.", "Observe les feuilles et les fleurs sans rien cueillir."),
        "Mammal": ("Look for movement and tracks from a respectful distance.", "Achte aus respektvollem Abstand auf Bewegung und Spuren.", "Observe les mouvements et les traces à distance respectueuse."),
        "Herpetofauna": ("Pause quietly near damp habitat; do not handle wildlife.", "Warte ruhig an feuchten Lebensräumen; fasse keine Tiere an.", "Arrête-toi près d’un milieu humide ; ne manipule aucun animal."),
        "Invertebrate": ("Watch flowers and leaves closely without touching or baiting.", "Beobachte Blüten und Blätter ohne Berühren oder Anlocken.", "Observe les fleurs et les feuilles sans toucher ni attirer les animaux."),
        "Other": ("Admire from the path; never pick or eat wild fungi or lichens.", "Bewundere sie vom Weg aus; sammle oder esse keine Pilze und Flechten.", "Admire-les depuis le sentier ; ne cueille ni ne mange champignons ou lichens."),
    }
    en, de, fr = tips.get(group, tips["Other"])
    return {"en": en, "de": de, "fr": fr}


def smooth_months(counts: dict[int, int]) -> dict[str, float]:
    total = sum(counts.values())
    if total <= 0:
        return {_month_key(month): 1.0 for month in range(1, 13)}
    shares = {month: counts.get(month, 0) / total for month in range(1, 13)}
    effort_share = 1 / 12
    raw_lifts = {month: min(5.0, max(0.2, shares[month] / effort_share)) for month in range(1, 13)}
    return {
        _month_key(month): round(
            0.25 * raw_lifts[12 if month == 1 else month - 1]
            + 0.5 * raw_lifts[month]
            + 0.25 * raw_lifts[1 if month == 12 else month + 1],
            5,
        )
        for month in range(1, 13)
    }


def active_seasons(month_lifts: dict[str, float]) -> dict[str, bool]:
    return {
        season: any(month_lifts[_month_key(month)] >= 0.8 for month in months)
        for season, months in SEASONS.items()
    }


def evaluate_backtest(
    training: list[Observation],
    held_out: list[Observation],
    anchors: list[dict[str, Any]],
    *,
    seed: int = 20261010,
    sample_size: int = 1000,
) -> dict[str, Any]:
    scenario_records: dict[tuple[str, int], Observation] = {}
    held_out_targets: dict[tuple[str, int], set[int]] = defaultdict(set)
    for item in held_out:
        if item.taxon_key and item.group != "Sensitive" and item.month and item.cell:
            key = (item.cell, item.month)
            scenario_records.setdefault(key, item)
            held_out_targets[key].add(item.taxon_key)
    eligible_scenarios = list(scenario_records.items())
    eligible_cells = {cell for cell, _ in eligible_scenarios}
    if not eligible_scenarios:
        raise ValueError("Held-out archive has no usable, non-sensitive, dated species observations.")
    if len(eligible_scenarios) < sample_size:
        raise ValueError(
            f"Held-out archive has {len(eligible_scenarios)} unique cell/month scenarios; "
            f"{sample_size} are required."
        )
    if len(eligible_cells) < 100:
        raise ValueError(
            "Held-out scenarios must cover at least 100 distinct H3 cells."
        )
    rng = random.Random(seed)
    all_cell: Counter[str] = Counter(item.cell for item in training if item.cell)
    all_parent: Counter[str] = Counter(item.parent for item in training if item.parent)
    species_cell: Counter[tuple[int, str]] = Counter(
        (item.taxon_key, item.cell) for item in training if item.taxon_key and item.group != "Sensitive"
    )
    species_parent: Counter[tuple[int, str]] = Counter(
        (item.taxon_key, item.parent) for item in training if item.taxon_key and item.group != "Sensitive"
    )
    species_month: Counter[tuple[int, int]] = Counter(
        (item.taxon_key, item.month) for item in training if item.taxon_key and item.group != "Sensitive" and item.month
    )
    all_time: Counter[str] = Counter(item.time_bucket for item in training if item.group != "Sensitive")
    all_weather: Counter[str] = Counter(item.weather_bucket for item in training if item.group != "Sensitive")
    species_time: dict[int, Counter[str]] = defaultdict(Counter)
    species_weather: dict[int, Counter[str]] = defaultdict(Counter)
    for item in training:
        if item.taxon_key and item.group != "Sensitive":
            species_time[item.taxon_key][item.time_bucket] += 1
            species_weather[item.taxon_key][item.weather_bucket] += 1
    time_lifts = {
        key: shrunk_lifts(counts, all_time)
        for key, counts in species_time.items()
    }
    weather_lifts = {
        key: shrunk_lifts(counts, all_weather)
        for key, counts in species_weather.items()
    }
    scenarios = rng.sample(eligible_scenarios, k=sample_size)
    outcome_model = outcome_a = outcome_b = 0
    measured = 0
    for scenario_key, scenario in scenarios:
        reachable_anchors = [
            anchor for anchor in anchors
            if h3.grid_distance(scenario.cell, anchor["cell"]) <= 3
        ]
        if not reachable_anchors:
            continue
        anchor = min(reachable_anchors, key=lambda item: (
            h3.great_circle_distance(
                (scenario.latitude, scenario.longitude),
                (item["latitude"], item["longitude"]),
                unit="m",
            ),
            item["id"],
        ))
        use_parent = not all_cell[anchor["cell"]]
        reference_cell = anchor["parent"] if use_parent else anchor["cell"]
        candidates = sorted({
            key for key, month in species_month if month in {scenario.month, 12 if scenario.month == 1 else scenario.month - 1, 1 if scenario.month == 12 else scenario.month + 1}
        })
        if not candidates:
            continue
        month_total = sum(species_month[(key, scenario.month)] for key in candidates)
        score = {}
        for key in candidates:
            observations = (
                species_parent[(key, reference_cell)] if use_parent else species_cell[(key, reference_cell)]
            )
            effort = all_parent[reference_cell] if use_parent else all_cell[reference_cell]
            month_count = species_month[(key, scenario.month)]
            score[key] = (
                (observations + 20 * (observations / max(effort, 1))) / (effort + 20)
            ) * (0.7 + 0.3 * month_count / max(month_total, 1)) \
                * time_lifts.get(key, {}).get(scenario.time_bucket, {}).get("lift", 1) \
                * weather_lifts.get(key, {}).get(scenario.weather_bucket, {}).get("lift", 1)
        ranked = sorted(candidates, key=lambda key: score[key], reverse=True)[:3]
        raw_ranked = sorted(candidates, key=lambda key: species_cell[(key, reference_cell)], reverse=True)[:3]
        active = [key for key in candidates if species_month[(key, scenario.month)] > 0]
        random_ranked = rng.sample(active, min(3, len(active))) if active else []
        observed_species = held_out_targets[scenario_key]
        outcome_model += int(bool(observed_species.intersection(ranked)))
        outcome_a += int(bool(observed_species.intersection(raw_ranked)))
        outcome_b += int(bool(observed_species.intersection(random_ranked)))
        measured += 1
    if measured != sample_size:
        raise ValueError(
            f"Only {measured} of {sample_size} held-out scenarios had reachable green anchors and support."
        )
    metrics = {
        "scenarios_requested": sample_size,
        "scenarios_scored": measured,
        "seed": seed,
        "model_likely_hit_rate": outcome_model / measured,
        "baseline_raw_cell_top3_hit_rate": outcome_a / measured,
        "baseline_random_active_top3_hit_rate": outcome_b / measured,
    }
    metrics["passed"] = (
        metrics["model_likely_hit_rate"] > metrics["baseline_raw_cell_top3_hit_rate"]
        and metrics["model_likely_hit_rate"] > metrics["baseline_random_active_top3_hit_rate"]
    )
    metrics["thresholds"] = {
        "likely_min_score": 0.0,
        "likely_max_count": 3,
        "calibration_note": "Score-band cutoffs require sufficient independent, season-stratified test observations; this prototype only validates model-vs-baseline hit rates.",
    }
    return metrics


def collect_species(
    records: list[Observation],
    identifiable: set[int],
    sensitive: set[int],
) -> tuple[list[dict[str, Any]], Counter[int]]:
    per_species: dict[int, list[Observation]] = defaultdict(list)
    for record in records:
        if record.taxon_key in identifiable and record.taxon_key not in sensitive and record.group != "Sensitive":
            per_species[record.taxon_key].append(record)
    selected: list[dict[str, Any]] = []
    kept_counts: Counter[int] = Counter()
    for key, observations in per_species.items():
        years = {item.observed_at.year for item in observations if item.observed_at}
        named_observations = [item for item in observations if item.scientific_name]
        if len(observations) < 30 or len(years) < 3 or not named_observations:
            continue
        names = named_observations[0].vernacular_names
        group = observations[0].group
        if group not in GROUP_QUOTAS:
            continue
        months = Counter(item.month for item in observations if item.month)
        month_lifts = smooth_months(dict(months))
        season_values = active_seasons(month_lifts)
        seasons_per_group = Counter()
        for item in observations:
            if item.month:
                season = next(name for name, season_months in SEASONS.items() if item.month in season_months)
                seasons_per_group[season] += 1
        selected.append({
            "id": str(key),
            "group": group,
            "emoji": "🌿",
            "names": names,
            "months": [month for month in range(1, 13) if month_lifts[_month_key(month)] >= 0.8],
            "month_lifts": month_lifts,
            "active_seasons": season_values,
            "season_observation_counts": dict(seasons_per_group),
            "habitats": [],
            "fieldcraft": fieldcraft_for(group),
            "observation_count": len(observations),
            "distinct_years": len(years),
            "images": sorted(
                {json.dumps(item.image, sort_keys=True) for item in observations if item.image}
            )[:6],
            "_rank": max(month_lifts.values()) * len(observations),
        })
    # Selection uses fixed group caps; season quotas are checked across the group.
    for group, quota in GROUP_QUOTAS.items():
        group_species = sorted((item for item in selected if item["group"] == group), key=lambda item: item["_rank"], reverse=True)
        if len(group_species) < quota:
            raise ValueError(f"{group} has {len(group_species)} eligible species; exactly {quota} are required.")
        minimum = max(1, int(quota * 0.3))
        for season in SEASONS:
            if not any(item["active_seasons"][season] for item in group_species[:quota]):
                candidates = [item for item in group_species[quota:] if item["active_seasons"][season]]
                if candidates:
                    replacement = candidates[0]
                    group_species = group_species[:max(0, quota - 1)] + [replacement]
        chosen = group_species[:quota]
        kept_counts[group] = len(chosen)
        season_supported = {
            season: sum(bool(item["active_seasons"][season]) for item in chosen)
            for season in SEASONS
        }
        if any(count < minimum for count in season_supported.values()):
            raise ValueError(
                f"{group} has fewer than 30% of its quota actively supported in every season: {season_supported}"
            )
    chosen_keys = {
        item["id"] for group in GROUP_QUOTAS
        for item in sorted((entry for entry in selected if entry["group"] == group), key=lambda entry: entry["_rank"], reverse=True)[:GROUP_QUOTAS[group]]
    }
    output = [{key: value for key, value in item.items() if not key.startswith("_")} for item in selected if item["id"] in chosen_keys]
    return output, kept_counts


def build_pack(
    training_archive: Path,
    held_out_archive: Path,
    boundary_path: Path,
    osm_path: Path,
    weather_path: Path,
    doi: str,
    output_path: Path,
    *,
    sources_path: Path,
    sensitive_path: Path,
    identifiable_path: Path,
    maximum_dropped_share: float = 0.5,
) -> dict[str, Any]:
    if not doi.strip().startswith("https://doi.org/"):
        raise ValueError("Provide the registered GBIF download DOI (https://doi.org/...).")
    dataset_key = configured_dataset_key(sources_path)
    max_age_years = configured_max_age_years(sources_path)
    max_uncertainty = configured_max_uncertainty_m(sources_path)
    verify_download_citation(training_archive, doi.strip())
    verify_download_citation(held_out_archive)
    boundary = get_berlin_polygon(boundary_path)
    weather = WeatherArchive(weather_path)
    sensitive = load_taxon_key_list(sensitive_path)
    identifiable = load_taxon_key_list(identifiable_path)
    if not sensitive:
        raise ValueError("Refusing release build: curate sensitive.yaml taxon_keys before processing.")
    if not identifiable:
        raise ValueError("Refusing release build: curate identifiability.yaml taxon_keys before processing.")

    training, drops, raw_clock, licenses = observations_from_archive(
        training_archive, boundary, weather, sensitive, identifiable, dataset_key,
        max_age_years=max_age_years, max_uncertainty=max_uncertainty,
    )
    held_out, held_out_drops, _, _ = observations_from_archive(
        held_out_archive, boundary, weather, sensitive, identifiable, dataset_key,
        max_age_years=max_age_years, max_uncertainty=max_uncertainty,
    )
    if not training or not held_out:
        raise ValueError("Both training and held-out archives must contain valid Berlin observations.")
    validate_temporal_holdout(training, held_out)
    osm_anchors = green_anchors(osm_path, boundary)
    species_pack, group_counts = collect_species(training, identifiable, sensitive)
    if not species_pack:
        raise ValueError("No curated, identifiable species met the support minimum of 30 records and 3 years.")

    all_cell_effort: Counter[str] = Counter(item.cell for item in training if item.cell)
    all_parent_effort: Counter[str] = Counter(item.parent for item in training if item.parent)
    total_detections = sum(item.taxon_key != 0 and item.group != "Sensitive" for item in training)
    berlin_rate = total_detections / max(len(training), 1)
    species_cell = Counter((item.taxon_key, item.cell) for item in training if item.taxon_key and item.group != "Sensitive")
    species_parent = Counter((item.taxon_key, item.parent) for item in training if item.taxon_key and item.group != "Sensitive")
    effort_month = Counter(item.month for item in training if item.month)
    effort_tod = Counter(item.time_bucket for item in training)
    effort_weather = Counter(item.weather_bucket for item in training)
    species_month: dict[int, Counter[int]] = defaultdict(Counter)
    species_tod: dict[int, Counter[str]] = defaultdict(Counter)
    species_weather: dict[int, Counter[str]] = defaultdict(Counter)
    for item in training:
        if item.taxon_key and item.group != "Sensitive":
            if item.month:
                species_month[item.taxon_key][item.month] += 1
            species_tod[item.taxon_key][item.time_bucket] += 1
            species_weather[item.taxon_key][item.weather_bucket] += 1
    parent_rates: dict[str, float] = {}
    species_rates: dict[int, dict[str, Any]] = {}
    for entry in species_pack:
        key = int(entry["id"])
        berlin_species_rate = sum(value for (taxon, _), value in species_cell.items() if taxon == key) / max(len(training), 1)
        per_cell = {}
        for cell in set(all_cell_effort) | {anchor["cell"] for anchor in osm_anchors}:
            parent = h3.cell_to_parent(cell, 7)
            parent_effort = all_parent_effort[parent]
            parent_species_count = species_parent[(key, parent)]
            parent_rate = (
                (parent_species_count + 20 * berlin_species_rate) / (parent_effort + 20)
                if parent_effort else berlin_species_rate
            )
            per_cell[cell] = {
                "rate": (species_cell[(key, cell)] + 20 * parent_rate) / (all_cell_effort[cell] + 20),
                "support": species_cell[(key, cell)],
                "effort": all_cell_effort[cell],
                "low_effort": all_cell_effort[cell] < 20,
                "parent_rate": parent_rate,
            }
        species_rates[key] = {
            "baseline_rate": berlin_species_rate,
            "cell_rates": per_cell,
            "month_lifts": smooth_months(dict(species_month[key])),
            "time_lifts": effort_lift_map(species_tod[key], effort_tod),
            "weather_lifts": effort_lift_map(species_weather[key], effort_weather),
            "low_confidence": {
                "month": sum(species_month[key].values()) < 30,
                "time": sum(species_tod[key].values()) < 30,
                "weather": sum(species_weather[key].values()) < 30,
            },
        }
        entry["cell_rates"] = per_cell
        entry["time_lifts"] = species_rates[key]["time_lifts"]
        entry["weather_lifts"] = species_rates[key]["weather_lifts"]
        entry["low_confidence"] = species_rates[key]["low_confidence"]

    calibration = evaluate_backtest(training, held_out, osm_anchors)
    raw_top_cells = all_cell_effort.most_common(10)
    cell_taxa: dict[str, set[int]] = defaultdict(set)
    for item in training:
        if item.cell and item.taxon_key and item.group != "Sensitive":
            cell_taxa[item.cell].add(item.taxon_key)
    normalized_top_cells = sorted(
        (
            (cell, round(len(cell_taxa[cell]) * 100 / max(all_cell_effort[cell], 1), 3))
            for cell in all_cell_effort
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:10]
    dropped_count = sum(drops.values())
    quality = {
        "training_observations": len(training),
        "held_out_observations": len(held_out),
        "dropped_records": dict(drops),
        "held_out_dropped_records": dict(held_out_drops),
        "dropped_share": dropped_count / max(dropped_count + len(training), 1),
        "time_of_day_spike_at_00_and_12": raw_clock[0] + raw_clock[12],
        "record_licences": dict(licenses),
        "species_per_group": dict(group_counts),
        "active_species_per_group_per_season": {
            group: {
                season: sum(
                    item["group"] == group and item["active_seasons"].get(season, False)
                    for item in species_pack
                )
                for season in SEASONS
            }
            for group in GROUP_QUOTAS
        },
        "cells_low_effort_before_normalization": sum(count < 20 for count in all_cell_effort.values()),
        "cells_low_effort_after_normalization": sum(
            all_cell_effort[cell] < 20 for cell in set(all_cell_effort) | {item["cell"] for item in osm_anchors}
        ),
        "top_ten_cells_by_raw_observations": raw_top_cells,
        "top_ten_cells_by_observed_taxa_per_100_records": normalized_top_cells,
        "green_anchor_count": len(osm_anchors),
        "held_out_metrics": calibration,
    }
    if not 0 <= maximum_dropped_share <= 1:
        raise ValueError("Maximum dropped-record share must be between 0 and 1.")
    if quality["dropped_share"] > maximum_dropped_share:
        raise ValueError(
            f"Dropped-record share {quality['dropped_share']:.3f} exceeds the configured maximum "
            f"{maximum_dropped_share:.3f}."
        )
    if not calibration["passed"]:
        raise ValueError(
            "Refusing to publish the pack: the model did not beat both held-out baselines. "
            f"Metrics: {json.dumps(calibration, sort_keys=True)}"
        )

    cells = set(all_cell_effort)
    try:
        boundary_cells = h3.geo_to_cells(boundary.__geo_interface__, 8)
    except Exception as error:
        raise ValueError(f"Could not polyfill the Berlin polygon with H3 resolution 8: {error}") from error
    empty_cells = len(set(boundary_cells) - cells)
    pack = {
        "schemaVersion": 1,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "usable": True,
        "source": {
            "provider": "GBIF occurrence download",
            "datasetKey": dataset_key,
            "downloadDoi": doi.strip(),
            "heldOutPeriodDays": 60,
            "downloadLicenceCounts": dict(licenses),
            "osmAttribution": "© OpenStreetMap contributors",
            "osmLicence": "ODbL",
            "weatherSource": "Open-Meteo historical archive at fixed Berlin centre (52.520, 13.405)",
            "weatherLicence": "CC BY 4.0",
        },
        "calibration": calibration,
        "quality": {**quality, "cells_without_data": empty_cells},
        "anchors": osm_anchors,
        "species": species_pack,
        "sensitiveTaxonCountExcluded": len(sensitive),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output_path)
    return pack


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training", type=Path, required=True, help="GBIF occurrence download ZIP used for training.")
    parser.add_argument("--held-out", type=Path, required=True, help="Separate GBIF download ZIP for the following 60 days.")
    parser.add_argument("--boundary", type=Path, required=True, help="Berlin boundary GeoJSON.")
    parser.add_argument("--osm", type=Path, required=True, help="Geofabrik Berlin OSM GeoJSON export with green polygons and walkable paths.")
    parser.add_argument("--weather", type=Path, required=True, help="Open-Meteo historical hourly JSON for fixed Berlin centre.")
    parser.add_argument("--doi", required=True, help="Training GBIF download DOI.")
    parser.add_argument("--sources", type=Path, default=Path("pipeline/sources.yaml"))
    parser.add_argument("--output", type=Path, default=Path("public/data/berlin-pack.json"))
    parser.add_argument("--sensitive", type=Path, default=Path("pipeline/sensitive.yaml"))
    parser.add_argument("--identifiability", type=Path, default=Path("pipeline/identifiability.yaml"))
    parser.add_argument("--maximum-dropped-share", type=float, default=0.5)
    args = parser.parse_args(argv)
    try:
        pack = build_pack(
            args.training, args.held_out, args.boundary, args.osm, args.weather,
            args.doi, args.output, sensitive_path=args.sensitive,
            sources_path=args.sources,
            identifiable_path=args.identifiability,
            maximum_dropped_share=args.maximum_dropped_share,
        )
    except (OSError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"Data pack build failed: {error}", file=sys.stderr)
        return 2
    print(json.dumps({
        "output": str(args.output),
        "species": len(pack["species"]),
        "anchors": len(pack["anchors"]),
        "calibration": pack["calibration"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
