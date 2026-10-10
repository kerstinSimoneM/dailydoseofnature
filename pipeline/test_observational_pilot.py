import json
import unittest
from datetime import datetime, timezone

import h3

from pipeline.build_observational_pilot import (
    DATASET_KEY,
    MIN_TAXON_CELLS,
    MIN_TAXON_RECORDS,
    build_pack,
    common_names_from_vernacular_rows,
    names_from_vernacular_rows,
)


class ObservationalPilotTests(unittest.TestCase):
    def test_uses_localized_common_names_with_clear_scientific_fallback(self):
        rows = [
            {"vernacularName": "Common issid planthopper", "language": "eng"},
            {"vernacularName": "Echte Käferzikade", "language": "deu"},
            {"vernacularName": "Isside commun", "language": "fra"},
        ]
        self.assertEqual(
            names_from_vernacular_rows(rows, "Issus coleoptratus"),
            {"en": "Common issid planthopper", "de": "Echte Käferzikade", "fr": "Isside commun"},
        )
        self.assertEqual(
            names_from_vernacular_rows([], "Issus coleoptratus"),
            {"en": "Issus coleoptratus", "de": "Issus coleoptratus", "fr": "Issus coleoptratus"},
        )

    def test_does_not_mislabel_a_common_name_as_another_language(self):
        german_rows = [{"vernacularName": "Echte Käferzikade", "language": "deu"}]
        self.assertEqual(
            common_names_from_vernacular_rows(german_rows, "Issus coleoptratus"),
            {"de": "Echte Käferzikade"},
        )
        self.assertEqual(
            names_from_vernacular_rows(german_rows, "Issus coleoptratus"),
            {"en": "Echte Käferzikade", "de": "Echte Käferzikade", "fr": "Echte Käferzikade"},
        )
        english_rows = [{"vernacularName": "Common issid planthopper", "language": "eng"}]
        self.assertEqual(
            common_names_from_vernacular_rows(english_rows, "Issus coleoptratus"),
            {"en": "Common issid planthopper"},
        )

    def make_records(self, *, threatened=False, license="http://creativecommons.org/publicdomain/zero/1.0/legalcode"):
        records = []
        for index in range(MIN_TAXON_RECORDS):
            cell_index = index % MIN_TAXON_CELLS
            latitude, longitude = h3.cell_to_latlng(
                h3.latlng_to_cell(52.30 + cell_index * 0.12, 13.10 + cell_index * 0.12, 6)
            )
            year = 2023 + index % 3
            classification = {
                "iucnRedListCategoryCode": "VU" if threatened else "LC",
            }
            records.append({
                "key": index + 1,
                "datasetKey": DATASET_KEY,
                "license": license,
                "basisOfRecord": "HUMAN_OBSERVATION",
                "speciesKey": 12345,
                "species": "Examplea berlinensis",
                "scientificName": "Examplea berlinensis Author",
                "kingdom": "Animalia",
                "class": "Aves",
                "decimalLatitude": latitude,
                "decimalLongitude": longitude,
                "coordinateUncertaintyInMeters": 25,
                "eventDate": f"{year}-04-{(index % 27) + 1:02d}",
                "classifications": {"iucn": classification},
            })
        return records

    def test_builds_widespread_multiyear_species_without_publishing_coordinates(self):
        pack = build_pack(
            self.make_records(),
            {"2023": 10, "2024": 10, "2025": 10},
            datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        self.assertEqual(pack["schemaVersion"], 2)
        self.assertEqual(pack["status"], "observational-pilot")
        self.assertEqual(pack["source"]["acceptedRecordCount"], MIN_TAXON_RECORDS)
        self.assertEqual(len(pack["species"]), 1)
        item = pack["species"][0]
        self.assertEqual(item["scientific_name"], "Examplea berlinensis")
        self.assertEqual(item["licenses"], ["CC0_1_0"])
        self.assertEqual(item["observation_count"], MIN_TAXON_RECORDS)
        self.assertEqual(len(item["cell_rates"]), MIN_TAXON_CELLS)
        serialized = json.dumps(pack)
        self.assertNotIn("decimalLatitude", serialized)
        self.assertNotIn("decimalLongitude", serialized)
        self.assertNotIn("52.45", serialized)

    def test_excludes_nonredistributable_and_threatened_records(self):
        with self.assertRaisesRegex(ValueError, "No taxa passed"):
            build_pack(
                self.make_records(license="http://creativecommons.org/licenses/by-nc/4.0/"),
                {},
                datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        with self.assertRaisesRegex(ValueError, "No taxa passed"):
            build_pack(
                self.make_records(threatened=True),
                {},
                datetime(2026, 1, 1, tzinfo=timezone.utc),
            )

    def test_suppresses_taxa_below_spatial_support_threshold(self):
        records = self.make_records()
        for record in records:
            record["decimalLatitude"] = 52.52
            record["decimalLongitude"] = 13.405
        with self.assertRaisesRegex(ValueError, "No taxa passed"):
            build_pack(records, {}, datetime(2026, 1, 1, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
