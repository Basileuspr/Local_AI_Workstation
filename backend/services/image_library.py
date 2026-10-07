"""Owned image collections. Source chats/workflows are never rewritten by filing."""
import hashlib
import io
import json
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from config import settings
from services import storage_libraries as storage
from services import review_metadata
from services import visual_review_names

ROOT = settings.data_dir / "image_library"
LOCK = threading.RLock()
MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 24_000_000


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".pending-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # Windows readers/virus scanners can briefly hold the destination open.
        # Retry only sharing/access errors, leaving the previous record intact.
        for attempt in range(6):
            try:
                temporary.replace(path)
                break
            except PermissionError:
                if attempt == 5: raise
                time.sleep(0.025 * (attempt + 1))
    finally:
        if temporary and temporary.exists(): temporary.unlink()


def identity(value):
    if not re.fullmatch(r"[0-9a-f]{32}", value or ""):
        raise ValueError("Invalid image or folder ID")
    return value


def read_index():
    path = ROOT / "index.json"
    if not path.exists(): return {"version": 1, "folders": [], "images": [], "tags": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("images"), list) or not isinstance(data.get("folders"), list):
        raise ValueError("Image library is unreadable. Its files were preserved.")
    data.setdefault("tags", [])
    if not isinstance(data["tags"], list): raise ValueError("Image tags are unreadable. Their records were preserved.")
    return data


def save_index(index):
    atomic(ROOT / "index.json", json.dumps(index, ensure_ascii=False).encode())


def inspect(data, name):
    if not data or len(data) > MAX_BYTES: raise ValueError("Images must be at most 20 MiB each")
    try:
        image = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("This file is not a supported, readable image") from error
    with image:
        if image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
            raise ValueError("Use single-frame images up to 24 megapixels")
        formats = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
        if image.format not in formats: raise ValueError("Use PNG, JPEG, WebP, or single-frame GIF")
        result = {"width": image.width, "height": image.height, "type": formats[image.format]}
        seed_text = image.info.get("local_ai_seed", "")
        if isinstance(seed_text, str) and re.fullmatch(r"[0-9]{1,10}", seed_text) and int(seed_text) <= 2_147_483_647:
            result["seed"] = int(seed_text)
        try:
            image.verify()
        except (OSError, SyntaxError) as error:
            raise ValueError("This image is incomplete or damaged") from error
    return {**result, "name": Path(name or "Image").name[:240], "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data), "created_at": datetime.now(timezone.utc).isoformat()}


def public_index():
    from services import image_vault
    with LOCK:
        index = read_index()
        value = {**index, "images": [decorate(item, include_names=False) for item in index["images"] if not image_vault.is_locked(item["sha256"])]}
    return visual_review_names.library_index(value)


def decorate(item, *, include_names=True):
    # All old direct uploads came from Image Review. Apply that separation to
    # existing records too, without rewriting user files just to list them.
    manual = review_metadata.metadata(item)
    record = media_record(item)
    value = {**item, **{key: manual[key] for key in ('schema_version', 'category', 'project', 'favorite', 'review_status')},
            **{key: record[key] for key in ('media_id', 'media_type', 'path', 'file_state', 'metadata')}, "review_only": item.get("review_only", False) or item.get("origin", {}).get("kind") in {"upload", "review"},
            "tag_ids": item.get("tag_ids", []), "annotations": item.get("annotations", {}),
            "url": f"/image-library/images/{item['id']}/content"}
    if include_names:
        value = visual_review_names.library_index({**read_index(), 'images': [value]})['images'][0]
    return value


def image_path(item):
    # This binding is written only by validated REVIEW organization/recovery.
    if item.get('review_location'):
        return storage.no_links(Path(item['review_location']))
    return storage.no_links(storage.resolve(ROOT / 'images' / (identity(item['id']) + '.image')))


def media_record(item):
    location = review_metadata.location(lambda: image_path(item),previous_path=item.get('path'))
    details = {key: item[key] for key in ('origin','annotations','sha256','seed','width','height','type','size','created_at') if key in item}
    return review_metadata.media_record('library',item['id'],manual=item,details=details,**location)


def import_image(data, name, origin=None, folder_id=None):
    from services import image_vault
    metadata = inspect(data, name)
    image_vault.require_public(metadata["sha256"])
    with LOCK:
        index = read_index()
        if origin and origin.get("workflow_id"):
            from services.image_workflows import store
            try: store.get(origin["workflow_id"])
            except store.NotFound: raise ValueError("The source workflow was deleted") from None
        if folder_id and not any(folder["id"] == folder_id for folder in index["folders"]): raise ValueError("Folder no longer exists")
        existing = next((item for item in index["images"] if item["sha256"] == metadata["sha256"]), None)
        if existing:
            changed = False
            if folder_id and folder_id not in existing["folder_ids"]:
                existing["folder_ids"].append(folder_id); changed = True
            if origin and origin.get("kind") == "review" and not existing.get("review_only"):
                existing["review_only"] = True; changed = True
            if changed: save_index(index)
            return decorate(existing)
        item = {**metadata, "id": uuid.uuid4().hex, "folder_ids": [folder_id] if folder_id else [], "rating": None,
                "origin": origin or {"kind": "upload"}, "annotations": {},
                "schema_version": 1, "category": "", "project": "", "favorite": False, "review_status": "unreviewed"}
        destination = storage.resolve(ROOT / "images" / (item["id"] + ".image"), create=True)
        atomic(destination, data)
        item.update(media_id='library:'+item['id'],media_type='image',path=str(destination.absolute()),file_state='present')
        index["images"].append(item)
        save_index(index)
        return decorate(item)


def image_bytes(item_id):
    from services import image_vault
    with LOCK:
        item = next((item for item in read_index()["images"] if item["id"] == identity(item_id)), None)
        if not item: raise ValueError("Image no longer exists")
        image_vault.require_public(item["sha256"])
        state = media_record(item)['file_state']
        if state != 'present': raise ValueError('Image file is missing. Restore its storage and refresh REVIEW.' if state=='missing' else 'Image storage is unavailable. Reconnect its storage and refresh REVIEW.')
        data = image_path(item).read_bytes()
        if hashlib.sha256(data).hexdigest() != item["sha256"]: raise ValueError("Stored image has changed")
        return data, item


def edit_image(item_id, *, rating=None, folder_ids=None, set_rating=False, hidden=None, caption=None, tag_ids=None, category=None, project=None, favorite=None, review_status=None):
    with LOCK:
        index = read_index()
        item = next((item for item in index["images"] if item["id"] == identity(item_id)), None)
        if not item: raise ValueError("Image no longer exists")
        from services import image_vault
        image_vault.require_public(item["sha256"])
        changes = {key: value for key, value in {'category': category, 'project': project,
                   'favorite': favorite, 'review_status': review_status}.items() if value is not None}
        if set_rating: changes['rating'] = rating
        manual = review_metadata.patch(item, changes)
        item.update({key: manual[key] for key in ('schema_version', 'rating', 'category', 'project', 'favorite', 'review_status')})
        if hidden is not None: item["hidden"] = hidden
        if caption is not None:
            if not isinstance(caption, str) or len(caption) > 10000: raise ValueError("Captions must be at most 10,000 characters")
            item.setdefault("annotations", {})["caption"] = caption
        if tag_ids is not None:
            display = visual_review_names.library_index(index)
            choices = {tag['id']: tag for tag in display['tags']}
            if len(tag_ids) > 100 or any(value not in choices for value in tag_ids):
                raise ValueError("Choose up to 100 existing image tags")
            attached = next(image['person_tag_ids'] for image in display['images'] if image['id'] == item_id)
            existing = {tag['id'] for tag in index['tags']}
            selected = []
            for value in dict.fromkeys(tag_ids):
                # Saving notes must not turn a linked face name into a manual
                # tag that survives moving that face to a different person.
                if value in attached and value not in item.get('tag_ids', []):
                    continue
                if value not in existing:
                    index['tags'].append({'id': value, 'name': choices[value]['name']})
                    existing.add(value)
                selected.append(value)
            item["tag_ids"] = selected
        if folder_ids is not None:
            known = {folder["id"] for folder in index["folders"]}
            if any(value not in known for value in folder_ids): raise ValueError("Folder no longer exists")
            item["folder_ids"] = list(dict.fromkeys(folder_ids))
        record = media_record(item)
        item.update({key: record[key] for key in ('media_id','media_type','path','file_state')})
        save_index(index)
        return decorate(item)


def tag(name, tag_id=None):
    name = name.strip()
    if not name or len(name) > 80: raise ValueError("Tag names need 1–80 characters")
    with LOCK:
        index = read_index()
        linked = next((tag for tag in visual_review_names.library_index(index)['tags']
                       if tag['id'] == tag_id and tag.get('person_id')), None) if tag_id else None
        if not linked:
            return _tag(index, name, tag_id)
    # Release the library lock before changing the face catalog.
    from services import visual_review
    result = visual_review.rename_person(linked['person_id'], name)
    return {'id': result['person_id'], 'name': result['name'], 'person_id': result['person_id']}


def _tag(index, name, tag_id):
    # Caller holds LOCK; ordinary manual tags retain their existing behavior.
    if any(item["name"].casefold() == name.casefold() and item["id"] != tag_id for item in index["tags"]):
        raise ValueError("An image tag already has that name")
    if tag_id:
        item = next((item for item in index["tags"] if item["id"] == identity(tag_id)), None)
        if not item: raise ValueError("Image tag no longer exists")
        item["name"] = name
    else:
        item = {"id": uuid.uuid4().hex, "name": name}; index["tags"].append(item)
    save_index(index)
    return item


def delete_tag(tag_id):
    with LOCK:
        index = read_index()
        if any(tag['id'] == tag_id and tag.get('person_id') for tag in visual_review_names.library_index(index)['tags']):
            raise ValueError('This name tag follows a person. Change its face grouping in Review & classify.')
        index["tags"] = [item for item in index["tags"] if item["id"] != identity(tag_id)]
        for image in index["images"]: image["tag_ids"] = [value for value in image.get("tag_ids", []) if value != tag_id]
        save_index(index)


def folder(name, folder_id=None):
    name = name.strip()
    if not name or len(name) > 120: raise ValueError("Folder names need 1–120 characters")
    with LOCK:
        index = read_index()
        if any(item["name"].casefold() == name.casefold() and item["id"] != folder_id for item in index["folders"]): raise ValueError("A folder already has that name")
        if folder_id:
            item = next((item for item in index["folders"] if item["id"] == identity(folder_id)), None)
            if not item: raise ValueError("Folder no longer exists")
            item["name"] = name
        else:
            item = {"id": uuid.uuid4().hex, "name": name}; index["folders"].append(item)
        save_index(index)
        return item


def delete_folder(folder_id):
    with LOCK:
        index = read_index()
        index["folders"] = [item for item in index["folders"] if item["id"] != identity(folder_id)]
        for image in index["images"]: image["folder_ids"] = [value for value in image["folder_ids"] if value != folder_id]
        save_index(index)


def delete_image(item_id):
    with LOCK:
        _, item = image_bytes(item_id)  # Validate ownership and prevent unauthenticated vault changes.
        index = read_index()
        index["images"] = [item for item in index["images"] if item["id"] != item_id]
        save_index(index)
        # Located external originals remain external source data. Only an
        # app-created transfer or the original library copy is owned here.
        if not item.get('review_location') or item.get('review_location_owned',False):
            image_path(item).unlink(missing_ok=True)


def source_bytes(source):
    """Typed IDs only: never accept client file paths or fetch remote URLs."""
    kind = source.get("kind")
    if kind == "library":
        return image_bytes(source.get("id"))
    if kind == "session":
        from services import session_store
        found = session_store.get_session_image_by_id(source.get("session_id"), source.get("message_id"), source.get("image_id"))
        if not found: raise ValueError("Source image is missing or locked")
        session = session_store.get_session(source["session_id"])
        return found[0], {"name": source.get("name") or "Chat image", "origin": {**source, "title": session.get("title")}}
    if kind == "workflow":
        from services.image_workflows import runner, exports
        if source.get("layout"):
            path, item = exports.stitched_path(source.get("workflow_id"), source.get("job_id"), source["layout"])
        else:
            path, item = runner.output_path(source.get("workflow_id"), source.get("job_id"), source.get("output_id"))
        return path.read_bytes(), {"name": source.get("name") or item.get("name") or "Workflow image", "origin": source}
    raise ValueError("Unknown image source")


def export_images(ids):
    """Export explicit public selections with ratings/captions, without changing them."""
    import zipfile
    if not isinstance(ids, list) or not 1 <= len(ids) <= 500:
        raise ValueError("Select 1–500 images for one export")
    ids = list(dict.fromkeys(identity(value) for value in ids))
    archive = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    try:
        with LOCK, zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as output:
            index = read_index()
            items = {item["id"]: item for item in index["images"]}
            if any(item_id not in items for item_id in ids): raise ValueError("A selected image is no longer available. Refresh the review list.")
            if sum(items[item_id]["size"] for item_id in ids) > 512 * 1024 * 1024:
                raise ValueError("Export up to 512 MiB at a time. Select fewer images.")
            for number, item_id in enumerate(ids, 1):
                data, item = image_bytes(item_id)  # Enforces vault privacy and verifies SHA-256.
                stem = re.sub(r"[^A-Za-z0-9._-]", "_", Path(item["name"]).stem).strip(".")[:100] or "image"
                suffix = {"image/png":".png", "image/jpeg":".jpg", "image/webp":".webp", "image/gif":".gif"}[item["type"]]
                name = f"images/{number:04d}-{stem}{suffix}"
                output.writestr(name, data)
                caption = item.get("annotations", {}).get("caption", "")
                output.writestr(str(Path(name).with_suffix(".txt")).replace("\\", "/"), caption.encode("utf-8"))
        archive.seek(0)
        return archive
    except Exception:
        archive.close()
        raise
