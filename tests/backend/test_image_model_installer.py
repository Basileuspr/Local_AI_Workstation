"""Installer selection, integrity, preservation and path boundaries; no network/GPU."""
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location("image_model_installer", Path(__file__).resolve().parents[2] / "scripts/install-image-models.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def sibling(name):
    return SimpleNamespace(rfilename=name)


def test_selects_one_fp16_copy_and_required_support_files():
    names = ["model_index.json", "README.md", "tokenizer/vocab.json", "unet/config.json",
             "unet/diffusion_pytorch_model.safetensors", "unet/diffusion_pytorch_model.fp16.safetensors",
             "vae/model.onnx", "vae/diffusion_pytorch_model.bin", "checkpoint.safetensors", "example.png"]
    selected = [item.rfilename for item in installer.select_files(list(map(sibling, names)))]
    assert set(selected) == {"model_index.json", "README.md", "tokenizer/vocab.json", "unet/config.json",
                             "unet/diffusion_pytorch_model.fp16.safetensors"}
    assert selected[-1] == "model_index.json"


@pytest.mark.parametrize("name", ["../outside.json", "/absolute.json", "tokenizer/../../outside.json", "C:/outside.json", "tokenizer\\outside.json"])
def test_rejects_remote_path_traversal(name):
    with pytest.raises(ValueError, match="Unsafe"):
        installer.select_files([sibling("model_index.json"), sibling(name)])


def test_rejects_checkpoint_without_pipeline_index():
    with pytest.raises(ValueError, match="model_index"):
        installer.select_files([sibling("unet/config.json")])


def test_checks_size_and_digest(tmp_path):
    path = tmp_path / "weights.safetensors"
    path.write_bytes(b"test")
    digest = hashlib.sha256(b"test").hexdigest()
    assert installer.verify_file(path, 4, digest) == digest
    with pytest.raises(ValueError, match="Size mismatch"):
        installer.verify_file(path, 5, digest)
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        installer.verify_file(path, 4, "0" * 64)


def test_preserves_unrecognized_existing_folder(tmp_path):
    model = tmp_path / "existing"
    model.mkdir()
    original = model / "original.txt"
    original.write_text("preserve me")
    with pytest.raises(FileNotFoundError):
        installer.check_existing(model, "dreamshaper-xl-1-0")
    assert original.read_text() == "preserve me"


def test_existing_install_requires_canonical_fp16_filename(tmp_path):
    name = "dreamshaper-xl-1-0"
    repo, revision = installer.CATALOG[name]
    (tmp_path / "model_index.json").write_text('{}')
    weight = tmp_path / "model.fp16.safetensors"
    weight.write_bytes(b"test")
    manifest = {"repo": repo, "revision": revision, "verified_files": [
        {"file": weight.name, "size": 4, "sha256": hashlib.sha256(b"test").hexdigest()}]}
    (tmp_path / "installation-manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(FileNotFoundError):
        installer.check_existing(tmp_path, name)
    (tmp_path / "model.safetensors").write_bytes(b"test")
    assert installer.check_existing(tmp_path, name)
    weight.write_bytes(b"oops")
    with pytest.raises(ValueError, match="SHA-256"):
        installer.check_existing(tmp_path, name)


def test_model_paths_cannot_escape_root(tmp_path):
    with pytest.raises(ValueError, match="escapes|links"):
        installer.paths(tmp_path, "../../outside")


def test_remote_failures_hide_response_text_and_continue(monkeypatch, tmp_path, capsys):
    attempts = []

    def fail_remote(command, **unused):
        attempts.append(command[3])
        raise RuntimeError("remote failure with signed URL and private credential")

    monkeypatch.setattr(installer.subprocess, "run", fail_remote)
    monkeypatch.setattr(installer.sys, "argv", ["install-image-models.py", "dreamshaper-xl-1-0",
                        "animagine-xl-4.0", "--models-dir", str(tmp_path)])
    assert installer.main() == 1
    assert attempts == ["dreamshaper-xl-1-0", "animagine-xl-4.0"]
    output = capsys.readouterr().out
    assert "private credential" not in output
    assert output.count('"status": "failed"') == 2
