from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image
from routes import image_generation as routes


@pytest.fixture
def output_route(tmp_path, monkeypatch):
    managed = tmp_path / "managed"
    managed.mkdir()
    Image.new("RGB", (8, 8), "red").save(managed / "generated.png")
    calls = []
    def generate(**options):
        calls.append(options)
        return {"filename": "generated.png", "url": "/image-generation/outputs/generated.png", "seed": 0}
    monkeypatch.setattr(routes, "OUTPUT_DIR", managed)
    monkeypatch.setattr(routes, "manager", SimpleNamespace(generate=generate))
    monkeypatch.setattr(routes.image_store, "BLOBS_DIR", tmp_path / "blobs")
    return managed, calls


def request(folder=None):
    return routes.ImageGenerationRequest(model_id="test", prompt="test", output_dir=str(folder) if folder is not None else None)


def test_selected_folder_receives_identical_png_without_changing_managed_output(output_route, tmp_path):
    managed, calls = output_route
    selected = tmp_path / "chosen folder"
    selected.mkdir()
    result = routes._generate_image(request(selected))
    assert Path(result["output_path"]).read_bytes() == (managed / "generated.png").read_bytes()
    assert result["image_ref"].startswith("blob:")
    assert "output_dir" not in calls[0]
    assert "output_warning" not in result


def test_clear_uses_only_default_and_selecting_default_does_not_overwrite(output_route):
    managed, _ = output_route
    assert "output_path" not in routes._generate_image(request())
    result = routes._generate_image(request(managed))
    assert Path(result["output_path"]) == managed / "generated.png"
    assert "output_warning" not in result


def test_queue_item_label_is_not_forwarded_to_image_pipeline(output_route):
    _, calls = output_route
    item = request()
    item.request_label = "Image 3 of 4"
    routes._generate_image(item)
    assert "request_label" not in calls[0]
    assert calls[0]["prompt"] == "test"


def test_existing_user_file_is_never_overwritten(output_route, tmp_path):
    managed, _ = output_route
    selected = tmp_path / "chosen"
    selected.mkdir()
    target = selected / "generated.png"
    target.write_bytes(b"existing user file")
    result = routes._generate_image(request(selected))
    assert target.read_bytes() == b"existing user file"
    assert result["output_warning"]
    assert "output_path" not in result
    assert (managed / "generated.png").is_file()
    assert result["image_ref"].startswith("blob:")


def test_missing_or_relative_folder_rejected_before_generation(output_route, tmp_path):
    _, calls = output_route
    for folder in [tmp_path / "missing", Path("relative")]:
        with pytest.raises(HTTPException) as error:
            routes._generate_image(request(folder))
        assert error.value.status_code == 400
    assert calls == []


def test_unwritable_destination_keeps_successful_generated_image(output_route, tmp_path, monkeypatch):
    _, _calls = output_route
    selected = tmp_path / "chosen"
    selected.mkdir()
    original = Path.open
    def denied(path, *args, **kwargs):
        if path.parent == selected and args and args[0] == "xb":
            raise PermissionError("Folder is read-only")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "open", denied)
    result = routes._generate_image(request(selected))
    assert "read-only" in result["output_warning"]
    assert result["image_ref"].startswith("blob:")
