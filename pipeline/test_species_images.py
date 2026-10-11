import tempfile
import unittest
from pathlib import Path

from pipeline.prepare_species_images import collect_credited_images


class SpeciesImageTests(unittest.TestCase):
    def test_includes_attributed_reuse_licenses_and_excludes_all_rights_reserved(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            image_dir = root / "images"
            image_dir.mkdir()
            for scientific_name in ("Example by", "Example nc", "Example reserved"):
                (image_dir / f"{scientific_name.replace(' ', '_')}.jpg").write_bytes(b"photo")
            credits_file = root / "credits.tsv"
            credits_file.write_text(
                "Example by\t(c) Photographer A, CC BY\tcc-by\n"
                "Example nc\t(c) Photographer B, CC BY-NC-ND\tcc-by-nc-nd\n"
                "Example reserved\t(c) Photographer C, all rights reserved\tNone\n",
                encoding="utf-8",
            )

            entries = collect_credited_images(image_dir, credits_file)

        self.assertEqual([entry["scientificName"] for entry in entries], ["Example by", "Example nc"])
        self.assertEqual(entries[0]["license"], "CC BY 4.0")
        self.assertEqual(entries[1]["license"], "CC BY-NC-ND 4.0")
        self.assertEqual(entries[1]["attribution"], "(c) Photographer B, CC BY-NC-ND")

    def test_skips_credit_rows_without_a_matching_image(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            image_dir = root / "images"
            image_dir.mkdir()
            credits_file = root / "credits.tsv"
            credits_file.write_text("Example species\t(c) Photographer\tcc-by\n", encoding="utf-8")

            entries = collect_credited_images(image_dir, credits_file)

        self.assertEqual(entries, [])


if __name__ == "__main__":
    unittest.main()
