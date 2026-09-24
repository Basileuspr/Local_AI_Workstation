"""Atomic metadata plus one shared original per content hash; crops are derived on demand."""
import hashlib
import io
import json
import math
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageOps

from config import settings
from services.image_library import atomic, identity, inspect
from services.image_vault import require_public
from .contracts import SourceId, Selection
from pydantic import TypeAdapter

ROOT = settings.data_dir / "character_datasets"
LOCK = threading.RLock()
MAX_SOURCES = 2000
MAX_SELECTIONS = 20000


class Conflict(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def directory(dataset_id):
    return ROOT / "datasets" / identity(dataset_id)


def read(dataset_id):
    with LOCK:
        path = directory(dataset_id) / "dataset.json"
        if not path.is_file():
            raise ValueError("Character dataset no longer exists")
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != 1 or data.get("id") != dataset_id:
            raise ValueError("Character dataset is unreadable; its files were preserved")
        return data


def write(data):
    data["updated_at"] = now()
    data["revision"] += 1
    atomic(directory(data["id"]) / "dataset.json", json.dumps(data, ensure_ascii=False).encode())
    return data


def check_revision(data, revision):
    if data["revision"] != revision:
        raise Conflict("This dataset changed. Refresh it and retry; your unsaved selection is still available.")


def create(name):
    name = name.strip()
    if not name or len(name) > 120:
        raise ValueError("Use a dataset name from 1 to 120 characters")
    with LOCK:
        return write({"version": 1, "id": uuid.uuid4().hex, "name": name, "revision": 0,
                      "created_at": now(), "sources": [], "selections": []})


def list_datasets():
    with LOCK:
        items = []
        for path in (ROOT / "datasets").glob("*/dataset.json"):
            data = read(path.parent.name)
            items.append({key: data[key] for key in ("id", "name", "updated_at")}
                         | {"source_count": len(data["sources"]), "accepted": sum(s["state"] == "accepted" for s in data["selections"])})
        return sorted(items, key=lambda item: item["updated_at"], reverse=True)


def source(data, source_id):
    TypeAdapter(SourceId).validate_python(source_id)
    found = next((item for item in data["sources"] if item["id"] == source_id), None)
    if found is None:
        raise ValueError("The image does not belong to this dataset")
    return found


def source_bytes(data, source_id):
    source(data, source_id)
    require_public(source_id)
    path = ROOT / "sources" / f"{source_id}.image"
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != source_id:
        raise ValueError("The source image changed on disk; import the original again")
    return payload


def import_image(dataset_id, payload, name, origin):
    meta = inspect(payload, name)
    digest = hashlib.sha256(payload).hexdigest()
    require_public(digest)
    with Image.open(io.BytesIO(payload)) as raw:
        image = ImageOps.exif_transpose(raw)
        width, height = image.size
    with LOCK:
        data = read(dataset_id)
        if any(item["id"] == digest for item in data["sources"]):
            return False
        if len(data["sources"]) >= MAX_SOURCES:
            raise ValueError(f"A dataset holds at most {MAX_SOURCES} source images")
        target = ROOT / "sources" / f"{digest}.image"
        if not target.exists():
            atomic(target, payload)
        data["sources"].append({"id": digest, "name": Path(name.replace("\\", "/")).name[:240],
            "width": width, "height": height, "type": meta["type"], "origin": origin,
            "caption": "", "caption_reviewed": False, "analysis": None, "added_at": now()})
        write(data)
        return True


def edit_source(dataset_id, source_id, revision, caption):
    with LOCK:
        data = read(dataset_id)
        check_revision(data, revision)
        item = source(data, source_id)
        item.update(caption=caption, caption_reviewed=True)
        return write(data)


def save_selection(dataset_id, revision, selection, selection_id=None):
    value = Selection.model_validate(selection).model_dump(mode="json")
    with LOCK:
        data = read(dataset_id)
        check_revision(data, revision)
        source(data, value["source_id"])
        require_public(value["source_id"])
        if selection_id:
            identity(selection_id)
            record = next((item for item in data["selections"] if item["id"] == selection_id), None)
            if record is None:
                raise ValueError("Selection no longer exists")
            if record["source_id"] != value["source_id"]:
                raise ValueError("A selection cannot be moved to another source image")
            record.update(value)
        else:
            if len(data["selections"]) >= MAX_SELECTIONS:
                raise ValueError("This dataset has reached its selection limit")
            data["selections"].append({**value, "id": uuid.uuid4().hex, "created_at": now(), "origin": "manual"})
        return write(data)


def set_state(dataset_id, request):
    with LOCK:
        data = read(dataset_id)
        check_revision(data, request.revision)
        wanted = set(request.ids)
        if wanted - {item["id"] for item in data["selections"]}:
            raise ValueError("One or more selections no longer exist")
        for item in data["selections"]:
            if item["id"] in wanted:
                if request.state == "accepted":
                    require_public(item["source_id"])
                item["state"] = request.state
        return write(data)


def add_analysis(dataset_id, source_id, analysis, model, parts, focus=None):
    with LOCK:
        data = read(dataset_id)
        item = source(data, source_id)
        require_public(source_id)
        if focus:
            require_public(focus["source_id"])
        regions = [r for r in analysis.regions if r.part in parts]
        if len(data["selections"]) + len(regions) > MAX_SELECTIONS:
            raise ValueError("This dataset has reached its selection limit")
        if not item.get("caption_reviewed"):
            item["caption"] = analysis.caption
        item["analysis"] = {"model": model, "at": now(), "warnings": analysis.warnings, "suggestions": len(regions), "focus": focus}
        # Reanalysis never replaces accepted, rejected, or manually edited selections.
        for region in regions:
            value = Selection(**region.model_dump(), source_id=source_id).model_dump(mode="json")
            if focus and value["part"] == "custom":
                value["detail"] = focus["detail"]
            if any(old["source_id"] == source_id and old["part"] == value["part"] and old["side"] == value["side"]
                   and old["detail"] == value["detail"] and old["box"] == value["box"]
                   and old.get("focus") == focus for old in data["selections"]):
                continue
            data["selections"].append({**value, "id": uuid.uuid4().hex, "created_at": now(), "origin": "vision", "model": model, "focus": focus})
        return write(data)


def selection(data, selection_id):
    identity(selection_id)
    found = next((item for item in data["selections"] if item["id"] == selection_id), None)
    if found is None:
        raise ValueError("Selection no longer exists")
    return found


def _render(payload, box=None, thumbnail=False):
    with Image.open(io.BytesIO(payload)) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        if box:
            left, top, right, bottom = box
            image = image.crop((math.floor(left * image.width), math.floor(top * image.height),
                                math.ceil(right * image.width), math.ceil(bottom * image.height)))
        if thumbnail:
            image.thumbnail((384, 384), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        return buffer.getvalue()


@lru_cache(maxsize=128)
def _thumbnail(root, source_id, size, modified, box):
    payload = (Path(root) / "sources" / f"{source_id}.image").read_bytes()
    if hashlib.sha256(payload).hexdigest() != source_id:
        raise ValueError("The source image changed on disk; import the original again")
    return _render(payload, box, True)


def render(data, source_id, box=None, thumbnail=False):
    source(data, source_id)
    require_public(source_id)
    if thumbnail:
        info = (ROOT / "sources" / f"{source_id}.image").stat()
        return _thumbnail(str(ROOT), source_id, info.st_size, info.st_mtime_ns, tuple(box) if box else None)
    return _render(source_bytes(data, source_id), box)


def export_dataset(dataset_id, scope="approved", ids=None, revision=None):
    data = read(dataset_id)
    if revision is not None and revision != data["revision"]:
        raise Conflict("The dataset changed. Refresh it before exporting.")
    if scope not in {"approved", "rejected", "selected"}:
        raise ValueError("Choose selected, approved, or rejected media")
    if scope == "selected":
        chosen = set(ids or [])
        if not chosen or not chosen <= {item["id"] for item in data["selections"]}:
            raise ValueError("Choose selections from this dataset before exporting")
        accepted = [item for item in data["selections"] if item["id"] in chosen]
    else:
        if ids:
            raise ValueError("Selection IDs are only valid for a selected-media export")
        state = "accepted" if scope == "approved" else "rejected"
        accepted = [item for item in data["selections"] if item["state"] == state]
    if not accepted:
        raise ValueError("Accept at least one selection before exporting" if scope == "approved" else "No rejected media to export")
    # A spooled archive bounds RAM use; it is removed when the response closes.
    archive = tempfile.TemporaryFile()
    try:
        full = {item["source_id"] for item in accepted if item["export_mode"] in {"full", "both"}}
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for source_id in sorted(full):
                item = source(data, source_id)
                output.writestr(f"full_images/{source_id}.png", render(data, source_id))
                output.writestr(f"full_images/{source_id}.txt", item["caption"])
            for item in accepted:
                require_public(item["source_id"])
                if item["export_mode"] in {"crop", "both"}:
                    output.writestr(f"crops/{item['id']}.png", render(data, item["source_id"], item["box"]))
                    output.writestr(f"crops/{item['id']}.txt", item["caption"])
            manifest = {"version": 1, "dataset": data["name"], "export_scope": scope, "revision": data["revision"], "exported_at": now(), "selections": accepted,
                        "sources": [item for item in data["sources"] if item["id"] in {s["source_id"] for s in accepted}]}
            output.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        archive.seek(0)
        return archive
    except BaseException:
        archive.close()
        raise
