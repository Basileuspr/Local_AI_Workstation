"""Explicit character associations. Unlinking never deletes a source.

Files uploaded from outside the app are kept in a shared, content-addressed
library under face_bank/assets (covered by the existing backup/reset scope).
Profiles refer to those copies or to IDs in the owning workspace.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
from functools import lru_cache
from pathlib import Path

from services.faces import bank, store
from services.image_library import atomic, identity

MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_RESOURCES = 500
KINDS = {"image", "face_dataset", "parts", "lora_project", "lora_adapter", "knowledge", "character", "file"}
AUDIO_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
               ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg",
               ".opus": "audio/ogg", ".webm": "audio/webm", ".aiff": "audio/aiff"}
VIDEO_TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
               ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
               ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".mpg": "video/mpeg",
               ".mpeg": "video/mpeg", ".ts": "video/mp2t", ".mts": "video/mp2t",
               ".m2ts": "video/mp2t", ".ogv": "video/ogg", ".3gp": "video/3gpp"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff"}
IMAGE_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif",
               "BMP": "image/bmp", "AVIF": "image/avif", "TIFF": "image/tiff"}
MEDIA_VERSION = 2


def media_type(source, suffix, fallback=None):
    """Inspect local bytes only; never follow playlists, URLs, or sidecar files."""
    if suffix in IMAGE_EXTENSIONS:
        from PIL import Image, UnidentifiedImageError
        from services.image_library import MAX_PIXELS
        try:
            with Image.open(source) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise ValueError("Choose an image up to 24 megapixels")
                mime = IMAGE_TYPES.get(image.format)
                if not mime:
                    raise ValueError("This raster image format is not supported")
                image.verify()
                return mime, "image"
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
            raise ValueError("This image is incomplete or unreadable") from exc
    if suffix in VIDEO_TYPES:
        try:
            import av
        except (ImportError, OSError):
            return fallback or (VIDEO_TYPES[suffix], "video")
        try:
            with av.open(source, options={"format_whitelist": "mov,matroska,webm,avi,asf,flv,mpeg,mpegts,ogg",
                                          "protocol_whitelist": "", "probesize": "1048576", "analyzeduration": "2000000"}) as container:
                if not container.streams.video and container.streams.audio:
                    mime = {".mp4": "audio/mp4", ".m4v": "audio/mp4", ".mov": "audio/mp4",
                            ".webm": "audio/webm", ".mkv": "audio/x-matroska", ".ogv": "audio/ogg"}.get(suffix, "application/octet-stream")
                    return mime, "audio"
        except (av.error.FFmpegError, ValueError, OSError):
            # Keep unsupported/corrupt containers as downloadable references.
            return fallback or (VIDEO_TYPES[suffix], "video")
        return VIDEO_TYPES[suffix], "video"
    if suffix in AUDIO_TYPES:
        return AUDIO_TYPES[suffix], "audio"
    return "application/octet-stream", "model" if suffix in {".safetensors", ".gguf"} else "document" if suffix in {".txt", ".md", ".pdf", ".docx", ".json"} else "file"


@lru_cache(maxsize=256)
def legacy_media_type(path, modified, suffix, previous_type, previous_category):
    # Upgrade the read model for previous uploads without changing bytes or IDs.
    with path.open("rb") as source:
        try:
            return media_type(source, suffix, (previous_type, previous_category))
        except ValueError:
            return previous_type, previous_category


def asset_path(asset_id, suffix):
    if not re.fullmatch(r"[a-f0-9]{64}", asset_id or ""):
        raise ValueError("Invalid saved file ID")
    return bank.ROOT / "assets" / f"{asset_id}.{suffix}"


def asset(asset_id):
    from services import image_vault
    path = asset_path(asset_id, "json")
    if not path.is_file() or not asset_path(asset_id, "blob").is_file():
        raise ValueError("Saved file no longer exists")
    image_vault.require_public(asset_id)
    data = json.loads(path.read_text(encoding="utf-8"))
    suffix = Path(data["name"]).suffix.lower()
    if data.get("media_version", 1) < MEDIA_VERSION and suffix in VIDEO_TYPES.keys() | IMAGE_EXTENSIONS:
        blob = asset_path(asset_id, "blob")
        data["media_type"], data["category"] = legacy_media_type(blob, blob.stat().st_mtime_ns, suffix, data["media_type"], data["category"])
    return {key: data[key] for key in ("id", "name", "size", "media_type", "category")}


def catalog(kind):
    """Only public display metadata, never local paths or model contents."""
    if kind == "image":
        from services import image_library
        return [{"id": item["id"], "name": item["name"], "url": item["url"], "category": "image"}
                for item in image_library.public_index()["images"] if not item.get("hidden")]
    if kind == "face_dataset":
        items = store.list_datasets()
    elif kind == "parts":
        from services.character_parts import store as parts
        items = parts.list_datasets()
    elif kind == "lora_project":
        from services import lora_store
        items = lora_store.list_projects()
    elif kind == "lora_adapter":
        from services import lora_store
        items = lora_store.list_adapters()
    elif kind == "knowledge":
        from services import knowledge_base
        return [{"id": item["doc_id"], "name": item["filename"]} for item in knowledge_base.list_documents()]
    elif kind == "character":
        items = bank.list_characters()
    elif kind == "file":
        items = []
        for path in (bank.ROOT / "assets").glob("*.json"):
            try:
                items.append(asset(path.stem))
            except (ValueError, OSError, KeyError):
                continue
        return sorted(items, key=lambda item: item["name"].casefold())
    else:
        raise ValueError("Choose a supported reference type")
    return [{"id": item["id"], "name": item["name"]} for item in items]


def resolve(kind, target_id):
    if kind not in KINDS:
        raise ValueError("Choose a supported reference type")
    if kind == "file":
        return asset(target_id)
    item = next((item for item in catalog(kind) if item["id"] == target_id), None)
    if item is None:
        raise ValueError("Reference is missing or unavailable in its workspace")
    return item


def list_resources(character_id):
    with bank.LOCK:
        links = bank._read(character_id)["resources"]
    # Resolve outside the bank lock: other workspaces have their own locks.
    catalogs = {}
    result = []
    for link in links:
        kind = link["kind"]
        if kind not in catalogs:
            try:
                catalogs[kind] = {item["id"]: item for item in catalog(kind)}
            except (ValueError, OSError):
                catalogs[kind] = {}
        item = catalogs[kind].get(link["target_id"])
        result.append({**link, "available": item is not None, "resource": item})
    return result


def linked_characters(kind, target_id):
    """Characters explicitly tied to one source, for that source's own workspace.

    Links to missing sources are still reported so they can be untied.
    """
    if kind not in KINDS:
        raise ValueError("Choose a supported reference type")
    found = []
    with bank.LOCK:
        if not bank.ROOT.is_dir():
            return []
        for path in bank.ROOT.glob("*.json"):
            try:
                data = bank._read(path.stem)
            except (ValueError, OSError):
                continue
            for link in data["resources"]:
                if link["kind"] == kind and link["target_id"] == target_id:
                    found.append({"character_id": data["id"], "name": data["name"],
                                  "link_id": link["id"], "note": link["note"]})
    return sorted(found, key=lambda item: item["name"].casefold())


def add(character_id, kind, target_id, note=""):
    resolve(kind, target_id)
    if kind == "character" and target_id == character_id:
        raise ValueError("Choose a different related character")
    if len(note) > 4000:
        raise ValueError("Reference notes must be at most 4,000 characters")
    with bank.LOCK:
        data = bank._read(character_id)
        found = next((link for link in data["resources"]
                      if link["kind"] == kind and link["target_id"] == target_id), None)
        if found:
            # Idempotent adds preserve the first annotation; edit it explicitly.
            return found
        if len(data["resources"]) >= MAX_RESOURCES:
            raise ValueError(f"A character holds up to {MAX_RESOURCES} linked resources")
        link = {"id": uuid.uuid4().hex, "kind": kind, "target_id": target_id,
                "note": note, "added_at": store.now()}
        data["resources"].append(link)
        bank._write(data)
        return link


def edit(character_id, link_id, note):
    identity(link_id)
    if len(note) > 4000:
        raise ValueError("Reference notes must be at most 4,000 characters")
    with bank.LOCK:
        data = bank._read(character_id)
        link = next((link for link in data["resources"] if link["id"] == link_id), None)
        if link is None:
            raise ValueError("Reference no longer belongs to this character")
        link["note"] = note
        bank._write(data)
        return link


def unlink(character_id, link_id):
    identity(link_id)
    with bank.LOCK:
        data = bank._read(character_id)
        data["resources"] = [item for item in data["resources"] if item["id"] != link_id]
        bank._write(data)


def save_asset(filename, payload):
    """Reuse the shared file library for explicit saves from other workspaces."""
    from services import image_vault
    if not payload or len(payload) > MAX_FILE_BYTES:
        raise ValueError("Choose a nonempty file up to 128 MiB")
    digest = hashlib.sha256(payload).hexdigest()
    image_vault.require_public(digest)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", (filename or "File").replace("\\", "/").rsplit("/", 1)[-1])[:200].strip(" .") or "File"
    suffix = Path(name).suffix.lower()
    mime, category = media_type(io.BytesIO(payload), suffix)
    with bank.LOCK:
        if not asset_path(digest, "json").is_file() or not asset_path(digest, "blob").is_file():
            atomic(asset_path(digest, "blob"), payload)
            atomic(asset_path(digest, "json"), json.dumps({"id": digest, "name": name, "size": len(payload),
                   "media_type": mime, "category": category, "media_version": MEDIA_VERSION}, ensure_ascii=False).encode())
        return asset(digest)


def upload(character_id, filename, payload, note=""):
    digest = hashlib.sha256(payload).hexdigest()
    with bank.LOCK:
        data = bank._read(character_id)  # Reject deleted profiles before writing a copy.
        if len(data["resources"]) >= MAX_RESOURCES and not any(
                item["kind"] == "file" and item["target_id"] == digest for item in data["resources"]):
            raise ValueError(f"A character holds up to {MAX_RESOURCES} linked resources")
        if len(note) > 4000:
            raise ValueError("Reference notes must be at most 4,000 characters")
        save_asset(filename, payload)
        return add(character_id, "file", digest, note)
