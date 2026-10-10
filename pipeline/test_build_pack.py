import json
import tempfile
import unittest
import zipfile
from datetime import datetime
from pathlib import Path

from shapely.geometry import Polygon

from pipeline.build_pack import (
    Observation,
    WeatherArchive,
    clean_record,
    configured_dataset_key,
    configured_max_age_years,
    configured_max_uncertainty_m,
    evaluate_backtest,
    multimedia_by_gbif_id,
    names_for,
    observations_from_archive,
    taxon_group,
    validate_temporal_holdout,
    verify_download_citation,
)


DATASET_KEY = "12345678-1234-1234-1234-123456789abc"


def observation(day: int, *, taxon_key: int = 123, cell: str = "cell") -> Observation:
    return Observation(
        taxon_key=taxon_key,
        group="Bird",
        latitude=52.52,
        longitude=13.405,
        cell=cell,
        parent="parent",
        observed_at=datetime(2025, 1, day),
        month=1,
        time_bucket="afternoon",
        weather_bucket="dry_sunny",
        license="",
        gbif_id="",
        image=None,
        scientific_name="Example bird",
        vernacular_names={"en": "Example bird", "de": "Beispielvogel", "fr": "Example bird"},
    )


class BuildPackTests(unittest.TestCase):
    def test_release_configuration_requires_a_verified_dataset_key_and_limits(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "sources.yaml"
            path.write_text(
                "observations:\n"
                f"  dataset_key: {DATASET_KEY}\n"
                "  max_age_years: 4\n"
                "  max_coordinate_uncertainty_m: 75\n",
                encoding="utf-8",
            )
            self.assertEqual(configured_dataset_key(path), DATASET_KEY)
            self.assertEqual(configured_max_age_years(path), 4)
            self.assertEqual(configured_max_uncertainty_m(path), 75)
            path.write_text("observations:\n  dataset_key: ''\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "verified GBIF dataset UUID"):
                configured_dataset_key(path)

    def test_rejects_captive_remarks_and_maps_supported_taxon_groups(self):
        boundary = Polygon([(13.3, 52.4), (13.5, 52.4), (13.5, 52.6), (13.3, 52.6)])
        valid = {
            "occurrenceStatus": "PRESENT",
            "basisOfRecord": "HUMAN_OBSERVATION",
            "taxonKey": "123",
            "decimalLongitude": "13.405",
            "decimalLatitude": "52.520",
            "coordinateUncertaintyInMeters": "25",
            "class": "Aves",
        }
        self.assertEqual(clean_record(valid, boundary), (True, "accepted"))
        self.assertEqual(
            clean_record({**valid, "occurrenceRemarks": "Seen in a zoo enclosure"}, boundary),
            (False, "captive_or_cultivated"),
        )
        self.assertEqual(taxon_group({"class": "Agaricomycetes", "kingdom": "Fungi"}), "Other")
        self.assertEqual(taxon_group({"class": "Insecta", "kingdom": "Animalia"}), "Invertebrate")

    def test_vernacular_name_uses_declared_language_and_scientific_fallback(self):
        names = names_for({"scientificName": "Turdus merula", "vernacularName": "Amsel", "language": "de"})
        self.assertEqual(names, {"en": "Turdus merula", "de": "Amsel", "fr": "Turdus merula"})

    def test_sensitive_records_are_excluded_before_coordinate_processing(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "occurrences.zip"
            columns = [
                "datasetKey", "occurrenceStatus", "basisOfRecord", "taxonKey",
                "decimalLongitude", "decimalLatitude", "coordinateUncertaintyInMeters", "class", "kingdom",
                "eventDate", "scientificName", "gbifID", "license",
            ]
            rows = [
                [DATASET_KEY, "PRESENT", "HUMAN_OBSERVATION", "7", "unused", "unused", "25", "Aves", "Animalia", "2025-01-02", "Sensitive owl", "1", "CC0"],
                [DATASET_KEY, "PRESENT", "HUMAN_OBSERVATION", "8", "13.406", "52.521", "25", "Aves", "Animalia", "2025-01-03", "Common bird", "2", "CC0"],
            ]
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("occurrence.txt", "\t".join(columns) + "\n" + "\n".join("\t".join(row) for row in rows))

            class Weather:
                @staticmethod
                def classify(_timestamp):
                    return "dry_sunny"

            boundary = Polygon([(13.3, 52.4), (13.5, 52.4), (13.5, 52.6), (13.3, 52.6)])
            records, drops, _, _ = observations_from_archive(
                archive_path,
                boundary,
                Weather(),
                {7},
                {8},
                DATASET_KEY,
            )
            with self.assertRaisesRegex(ValueError, "datasetKey"):
                observations_from_archive(
                    archive_path, boundary, Weather(), {7}, {8},
                    "87654321-4321-4321-4321-cba987654321",
                )

        self.assertEqual(len(records), 1)
        common = records[0]
        self.assertEqual(drops["sensitive_from_species_records"], 1)
        self.assertEqual(common.scientific_name, "Common bird")

    def test_weather_archive_requires_fixed_berlin_coordinates(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "weather.json"
            archive = {
                "latitude": 52.52,
                "longitude": 13.4,
                "hourly": {
                    "time": ["2025-01-01T00:00"],
                    "temperature_2m": [5],
                    "precipitation": [0],
                    "snowfall": [0],
                    "weather_code": [0],
                    "cloud_cover": [0],
                },
            }
            path.write_text(json.dumps(archive), encoding="utf-8")
            self.assertEqual(WeatherArchive(path).classify(datetime(2025, 1, 1)), "dry_sunny")
            archive["longitude"] = 13.8
            path.write_text(json.dumps(archive), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "fixed Berlin centre"):
                WeatherArchive(path)

    def test_training_and_held_out_dates_must_be_separate_and_bounded(self):
        validate_temporal_holdout([observation(1)], [observation(2)])
        with self.assertRaisesRegex(ValueError, "strictly after"):
            validate_temporal_holdout([observation(2)], [observation(2)])
        with self.assertRaisesRegex(ValueError, "60 days"):
            validate_temporal_holdout(
                [observation(1)],
                [
                    observation(2),
                    Observation(
                        **{
                            **observation(1).__dict__,
                            "observed_at": datetime(2025, 4, 5),
                        }
                    ),
                ],
            )

    def test_backtest_requires_distinct_cell_month_scenarios(self):
        with self.assertRaisesRegex(ValueError, "unique cell/month scenarios"):
            evaluate_backtest([observation(1)], [observation(2)], [])

    def test_training_doi_must_match_the_archive_citation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "download.zip"
            doi = "https://doi.org/10.1234/example"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("citation.txt", f"GBIF Occurrence Download {doi}")
            verify_download_citation(path, doi)
            with self.assertRaisesRegex(ValueError, "does not match"):
                verify_download_citation(path, "https://doi.org/10.5678/other")

    def test_multimedia_keeps_only_supported_redistribution_licenses(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "archive.zip"
            columns = ["gbifID", "identifier", "license", "creator", "title"]
            rows = [
                ["1", "https://example.org/by.jpg", "https://creativecommons.org/licenses/by/4.0/", "Author", "Bird"],
                ["2", "https://example.org/nc.jpg", "https://creativecommons.org/licenses/by-nc/4.0/", "Author", "Bird"],
            ]
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("multimedia.txt", "\t".join(columns) + "\n" + "\n".join("\t".join(row) for row in rows))
            with zipfile.ZipFile(path) as archive:
                result = multimedia_by_gbif_id(archive, "multimedia.txt")
        self.assertEqual(list(result), ["1"])
        self.assertEqual(result["1"]["license"], "https://creativecommons.org/licenses/by/4.0/")


if __name__ == "__main__":
    unittest.main()
