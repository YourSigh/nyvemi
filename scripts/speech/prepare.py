#!/usr/bin/env python3
"""Prepare verified Android speech assets outside Git."""
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/"
RUNTIME = "v2.0.1/sherpa-onnx-2.0.1.aar"
MODEL = "tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2"
RUNTIME_SHA = "a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7"
MODEL_SHA = "259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c"
MODEL_DIR = "kokoro-int8-multi-lang-v1_1"
MODEL_FILES = (
    "model.int8.onnx", "tokens.txt", "lexicon-zh.txt", "lexicon-us-en.txt",
    "phone-zh.fst", "date-zh.fst", "number-zh.fst", "LICENSE",
)
VOICE_BYTES = 522240
SPEAKER_COUNT = 103


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def download(cache, name, expected):
    target = cache / Path(name).name
    if target.is_file() and digest(target) == expected:
        return target
    with tempfile.TemporaryDirectory(dir=cache) as temp:
        partial = Path(temp) / target.name
        subprocess.run([
            "curl", "--fail", "--location", "--silent", "--show-error",
            "--proto", "=https", "--proto-redir", "=https", "--retry", "2",
            "--max-time", "300", "--output", str(partial), BASE + name,
        ], check=True)
        if digest(partial) != expected:
            raise ValueError(f"Unexpected SHA-256 for {name}")
        partial.replace(target)
    return target


def prepare(output, cache, catalog):
    cache.mkdir(parents=True, exist_ok=True)
    runtime = download(cache, RUNTIME, RUNTIME_SHA)
    model = download(cache, MODEL, MODEL_SHA)
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(runtime) as aar:
        for name in aar.namelist():
            if name == "classes.jar" or (name.startswith("jni/") and name.endswith(
                ("/libonnxruntime.so", "/libsherpa-onnx-jni.so")
            )):
                aar.extract(name, output)
    asset_dir = output / "assets" / "nyvemi-tts"
    asset_dir.mkdir(parents=True, exist_ok=True)
    ids = {voice["sid"] for voice in json.loads(catalog.read_text(encoding="utf-8"))}
    if not ids or min(ids) < 0 or max(ids) >= SPEAKER_COUNT:
        raise ValueError("Invalid starter voice catalog")
    # The graph validates the full style-table size. Zero unused slots so only
    # the curated speaker vectors contribute to compressed APK size.
    with tarfile.open(model, "r:bz2") as archive:
        for name in MODEL_FILES:
            with archive.extractfile(f"{MODEL_DIR}/{name}") as source:
                with (asset_dir / name).open("wb") as dest:
                    shutil.copyfileobj(source, dest)
        with archive.extractfile(f"{MODEL_DIR}/voices.bin") as source:
            with (asset_dir / "voices.bin").open("wb") as dest:
                for sid in range(SPEAKER_COUNT):
                    voice = source.read(VOICE_BYTES)
                    if len(voice) != VOICE_BYTES:
                        raise ValueError("Incomplete Kokoro voice table")
                    dest.write(voice if sid in ids else bytes(VOICE_BYTES))
                if source.read(1):
                    raise ValueError("Unexpected Kokoro voice table size")
    shutil.copyfile(catalog, asset_dir / "catalog.json")


if __name__ == "__main__":
    prepare(*map(Path, sys.argv[1:]))
