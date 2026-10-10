"""Package an already-reviewed MLC model and compatible WASM library for same-origin hosting."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

REQUIRED_MODEL_FILES = {"mlc-chat-config.json", "ndarray-cache.json"}
REQUIRED_LICENSE_FILES = {"LICENSE"}
IGNORED_FILES = {".DS_Store"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sri_for(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256-{base64.b64encode(digest.digest()).decode('ascii')}"


def collect_model_files(model_dir: Path) -> list[Path]:
    files = sorted(path for path in model_dir.rglob("*") if path.is_file() and path.name not in IGNORED_FILES)
    missing = REQUIRED_MODEL_FILES - {path.name for path in files}
    missing |= REQUIRED_LICENSE_FILES - {path.name for path in files}
    if missing:
        raise ValueError(f"Model directory is missing required files: {', '.join(sorted(missing))}")
    if not any(path.name.startswith("params_shard_") and path.suffix == ".bin" for path in files):
        raise ValueError("No MLC params_shard_*.bin weight files were found.")
    return files


def build_manifest(
    model_dir: Path,
    model_lib: Path,
    output_dir: Path,
    *,
    model_id: str,
    revision: str,
) -> dict[str, Any]:
    if len(revision) != 40 or any(char not in "0123456789abcdef" for char in revision.lower()):
        raise ValueError("revision must be a full, immutable 40-character lowercase Git commit hash.")
    if not model_id or any(char in model_id for char in "/\\"):
        raise ValueError("model_id must be a plain identifier without path separators.")
    if not model_lib.is_file() or model_lib.suffix != ".wasm":
        raise ValueError("model_lib must be a compatible .wasm model library file.")

    model_dir = model_dir.resolve()
    output_dir = output_dir.resolve()
    model_base = output_dir / model_id / "resolve" / revision
    library_dir = output_dir / "lib"
    model_base.mkdir(parents=True, exist_ok=True)
    library_dir.mkdir(parents=True, exist_ok=True)

    source_files = collect_model_files(model_dir)
    for source in source_files:
        relative = source.relative_to(model_dir)
        destination = model_base / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    library_name = f"{model_id}-{revision}.wasm"
    library_destination = library_dir / library_name
    shutil.copy2(model_lib, library_destination)

    packaged_files = sorted(path for path in model_base.rglob("*") if path.is_file())
    file_hashes = {
        path.relative_to(model_base).as_posix(): {
            "sha256": sha256_file(path),
            "sizeBytes": path.stat().st_size,
        }
        for path in packaged_files
    }
    config_name = "mlc-chat-config.json"
    tokenizer_files = [name for name in file_hashes if "tokenizer" in Path(name).name.lower()]
    if not tokenizer_files:
        raise ValueError("No tokenizer files found. Refusing to package an incomplete model.")
    integrity: dict[str, Any] = {
        "config": sri_for(model_base / config_name),
        "model_lib": sri_for(library_destination),
        "tokenizer": {name: sri_for(model_base / name) for name in tokenizer_files},
        "onFailure": "error",
    }
    total_size = sum(item["sizeBytes"] for item in file_hashes.values()) + library_destination.stat().st_size
    release_hashes = [f"{name}:{file_hashes[name]['sha256']}" for name in sorted(file_hashes)]
    release_hashes.append(f"lib/{library_name}:{sha256_file(library_destination)}")
    return {
        "enabled": True,
        "modelId": model_id,
        "revision": revision.lower(),
        "modelUrl": f"/models/{model_id}/resolve/{revision.lower()}/",
        "modelLibUrl": f"/models/lib/{library_name}",
        "modelSizeBytes": total_size,
        "modelSha256": hashlib.sha256("\n".join(release_hashes).encode("ascii")).hexdigest(),
        "files": file_hashes,
        "integrity": integrity,
        "licensePath": "LICENSE",
        "hosting": "same-origin",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True, help="Reviewed MLC model directory.")
    parser.add_argument("--model-lib", type=Path, required=True, help="Compatible WebLLM .wasm model library.")
    parser.add_argument("--model-id", required=True, help="WebLLM model_id, e.g. SmolLM2-360M-Instruct-q4f16_1-MLC.")
    parser.add_argument("--revision", required=True, help="Full 40-character immutable model source commit.")
    parser.add_argument("--output-dir", type=Path, default=Path("public/models"))
    args = parser.parse_args()
    manifest = build_manifest(
        args.model_dir,
        args.model_lib,
        args.output_dir,
        model_id=args.model_id,
        revision=args.revision,
    )
    manifest_path = Path("public/model-manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Packaged {manifest['modelId']} ({manifest['modelSizeBytes']} bytes).")
    print(f"Manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
