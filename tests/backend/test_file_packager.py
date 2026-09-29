import io
import json
import zipfile

import pytest
from fastapi import FastAPI, UploadFile
from fastapi.testclient import TestClient
from routes.workspaces import router
from services import file_packager as packager


def upload(data=b"sample"):
    return UploadFile(file=io.BytesIO(data), filename="original.bin", size=len(data))


@pytest.mark.parametrize("compression, method", [("compressed", zipfile.ZIP_DEFLATED), ("stored", zipfile.ZIP_STORED)])
def test_zip_preserves_binary_unicode_empty_files_and_folders(compression, method):
    contents = [bytes(range(256)) * 12, "Hello 世界".encode(), b"", b""]
    paths = ["folder/data.bin", "folder/世界.txt", "zero.txt", "empty"]
    target = packager.build_package([upload(data) for data in contents], [
        {"path": path, "directory": index == 3} for index, path in enumerate(paths)
    ], compression)
    try:
        with zipfile.ZipFile(target) as archive:
            assert archive.testzip() is None
            assert archive.namelist() == paths[:3] + ["empty/"]
            for path, data in zip(paths[:3], contents):
                assert archive.read(path) == data
                assert archive.getinfo(path).compress_type == method
            assert archive.getinfo("empty/").is_dir()
    finally:
        target.unlink()


@pytest.mark.parametrize("path", ["../escape", "/absolute", "C:/secret", "a\\b", "folder/../file", "a\x00b", "file:stream", "bad./file"])
def test_rejects_unsafe_paths(path):
    with pytest.raises(ValueError):
        packager.build_package([upload()], [{"path": path, "directory": False}])


@pytest.mark.parametrize("paths", [["a", "A"], ["a", "a/b"]])
def test_rejects_overlapping_paths(paths):
    with pytest.raises(ValueError):
        packager.build_package([upload(), upload()], [{"path": path, "directory": False} for path in paths])


def test_size_limit_checks_actual_bytes_and_cleans_partial_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(packager, "MAX_BYTES", 3)
    monkeypatch.setattr(packager.tempfile, "tempdir", str(tmp_path))
    item = upload(b"too big")
    item.size = None
    with pytest.raises(ValueError, match="512 MiB"):
        packager.build_package([item], [{"path": "file", "directory": False}])
    assert list(tmp_path.iterdir()) == []


def test_endpoint_download_and_temp_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr(packager.tempfile, "tempdir", str(tmp_path))
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/workspaces/package", data={
            "name": "My package", "entries": json.dumps([{"path": "nested/a.txt", "directory": False}]),
        }, files=[("files", ("a.txt", b"unchanged content", "text/plain"))])
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert "My%20package.zip" in response.headers["content-disposition"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.read("nested/a.txt") == b"unchanged content"
        assert list(tmp_path.iterdir()) == []
        assert client.post("/workspaces/package", data={"entries": "not-json"}, files={"files": ("x", b"x")}).status_code == 400
        assert client.post("/workspaces/package", data={"entries": "[]"}, files={"files": ("x", b"x")}).status_code == 400
