import tempfile
import unittest
from pathlib import Path

from pipeline.prepare_model import build_manifest


REVISION = "a" * 40


class ModelPackagerTests(unittest.TestCase):
    def test_creates_a_pinned_same_origin_manifest_and_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_dir = root / "model"
            model_dir.mkdir()
            (model_dir / "mlc-chat-config.json").write_text("{}", encoding="utf-8")
            (model_dir / "ndarray-cache.json").write_text("{}", encoding="utf-8")
            (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
            (model_dir / "params_shard_0.bin").write_bytes(b"model-bytes")
            (model_dir / "LICENSE").write_text("Open model licence", encoding="utf-8")
            model_lib = root / "model.wasm"
            model_lib.write_bytes(b"wasm-bytes")

            manifest = build_manifest(
                model_dir,
                model_lib,
                root / "public" / "models",
                model_id="SmolLM2-360M-Instruct-q4f16_1-MLC",
                revision=REVISION,
            )

            self.assertTrue(manifest["enabled"])
            self.assertEqual(manifest["revision"], REVISION)
            self.assertIn(REVISION, manifest["modelUrl"])
            self.assertTrue(manifest["modelLibUrl"].startswith("/models/"))
            self.assertEqual(manifest["hosting"], "same-origin")
            self.assertIn("params_shard_0.bin", manifest["files"])
            self.assertTrue(manifest["integrity"]["config"].startswith("sha256-"))
            self.assertEqual(manifest["modelSizeBytes"], 11 + 2 + 2 + 2 + 18 + 10)

    def test_rejects_floating_revisions_and_incomplete_model_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_dir = root / "model"
            model_dir.mkdir()
            model_lib = root / "model.wasm"
            model_lib.write_bytes(b"wasm")

            with self.assertRaisesRegex(ValueError, "40-character"):
                build_manifest(model_dir, model_lib, root / "out", model_id="model", revision="main")
            with self.assertRaisesRegex(ValueError, "missing required files"):
                build_manifest(model_dir, model_lib, root / "out", model_id="model", revision=REVISION)


if __name__ == "__main__":
    unittest.main()
