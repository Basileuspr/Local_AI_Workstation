"""Independent still-image folder catalog and reviewed, hash-verified transfers.

No Media Manager imports, data, processes or FFmpeg calls. Opening the workspace
reads this catalog only; scans and file operations require explicit requests.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import stat
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps
from config import settings
from . import image_manager_trash
from . import visual_review_names

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".avif", ".gif"}
FORMATS = {"JPEG", "PNG", "WEBP", "BMP", "TIFF", "AVIF", "GIF"}
LAYOUTS = {"month", "day", "format", "folders"}
FUNCTION_STEPS = {"scan", "duplicates", "plan", "duplicate-plan", "report"}
MAX_PLAN = 1000
MAX_PREVIEW_PIXELS = 40_000_000


class Stopped(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def path_key(path):
    return str(Path(path).absolute()).casefold()


def no_links(path):
    """Validate every existing component before resolving a filesystem path."""
    path = Path(path).absolute()
    for part in [path, *path.parents]:
        if part.is_symlink() or part.is_junction():
            raise ValueError("Directory links, symbolic links and junctions are excluded.")
    if any("nvidia" in part.casefold() for part in path.parts):
        raise ValueError("NVIDIA paths are excluded.")
    return path


def signature(info):
    return [info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino]


def image_metadata(path):
    info = path.stat()
    with Image.open(path) as image:
        if image.format not in FORMATS or getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) > 1:
            raise ValueError("Animated/multiple-frame media is excluded.")
        width, height = image.size
        orientation = 1
        captured = None
        try:
            exif = image.getexif()
            orientation = exif.get(274, 1)
            dates = [exif.get(36867), exif.get_ifd(34665).get(36867), exif.get(306)]
            for value in dates:
                if isinstance(value, str):
                    try:
                        captured = datetime.strptime(value.rstrip("\x00"), "%Y:%m:%d %H:%M:%S").isoformat()
                        break
                    except ValueError:
                        continue
        except (ValueError, KeyError, TypeError, OSError, SyntaxError):
            pass
        if orientation in (5, 6, 7, 8):
            width, height = height, width
        return {"width": width, "height": height, "format": image.format,
                "date": captured or datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
                "date_source": "EXIF" if captured else "File modified", "signature": signature(info), "bytes": info.st_size}


class ImageManager:
    def __init__(self, directory=None, *, scan_limit=100_000):
        self.directory = Path(directory) if directory is not None else settings.data_dir / "image_manager"
        self.scan_limit = scan_limit
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.job = None
        self.worker = None
        self._initialized = False
        self.preview_slots = threading.BoundedSemaphore(2)
        self.trash_reviews = {}

    @contextmanager
    def database(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.directory / "catalog.sqlite3", timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            with self.lock:
                if not self._initialized:
                    connection.executescript("""
                    PRAGMA journal_mode=WAL;
                    CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,path TEXT NOT NULL,key TEXT UNIQUE,purpose TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,folder_id TEXT NOT NULL,relative TEXT NOT NULL,key TEXT UNIQUE,
                      bytes INTEGER,width INTEGER,height INTEGER,format TEXT,date TEXT,date_source TEXT,signature TEXT,
                      sha256 TEXT,available INTEGER DEFAULT 1,favorite INTEGER DEFAULT 0,tags TEXT DEFAULT '[]',seen TEXT);
                    CREATE INDEX IF NOT EXISTS images_folder ON images(folder_id);
                    CREATE INDEX IF NOT EXISTS images_hash ON images(sha256);
                    CREATE TABLE IF NOT EXISTS functions(id TEXT PRIMARY KEY,name TEXT NOT NULL,recipe TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS trash(id TEXT PRIMARY KEY,value TEXT NOT NULL);
                    """)
                    if "hidden" not in {row["name"] for row in connection.execute("PRAGMA table_info(images)")}:
                        connection.execute("ALTER TABLE images ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
                    connection.commit()
                    # An app restart never resumes transfers. Mark unfinished journals
                    # for review while retaining every per-file outcome already saved.
                    for row in connection.execute("SELECT id,value FROM receipts").fetchall():
                        receipt = json.loads(row["value"])
                        if receipt["status"] == "running":
                            receipt["status"] = "interrupted"
                            receipt["finished"] = now()
                            connection.execute("UPDATE receipts SET value=? WHERE id=?", (json.dumps(receipt), row["id"]))
                    connection.commit()
                    self._initialized = True
            yield connection
            connection.commit()
        finally:
            connection.close()

    def folders(self):
        with self.database() as db:
            return [dict(row) for row in db.execute("SELECT f.*, (SELECT COUNT(*) FROM images i WHERE i.folder_id=f.id AND i.available=1) AS count FROM folders f ORDER BY f.path COLLATE NOCASE")]

    def add_folder(self, value, purpose="source"):
        if purpose not in ("source", "output") or not isinstance(value, str) or not value or not Path(value).is_absolute():
            raise ValueError("Choose an absolute folder path.")
        root = no_links(Path(value))
        if image_manager_trash.TRASH_NAME in root.parts:
            raise ValueError("Trash folders are excluded from the image catalog. Use the Trash view to restore files.")
        if not root.is_dir():
            raise ValueError("Choose an existing folder.")
        # Keep the manager's own catalog and thumbnails out of its source index.
        if purpose == "source" and (self.directory.absolute().is_relative_to(root) or root.is_relative_to(self.directory.absolute())):
            raise ValueError("Choose an image folder outside the manager's data directory.")
        with self.database() as db:
            existing = db.execute("SELECT * FROM folders WHERE key=?", (path_key(root),)).fetchone()
            if existing:
                if purpose == "source" and existing["purpose"] == "output":
                    db.execute("UPDATE folders SET purpose='source' WHERE id=?", (existing["id"],))
                return {**dict(existing), "purpose": "source" if purpose == "source" else existing["purpose"]}
            record = {"id": uuid.uuid4().hex, "path": str(root), "key": path_key(root), "purpose": purpose}
            db.execute("INSERT INTO folders VALUES(:id,:path,:key,:purpose)", record)
            return record

    def folder(self, identifier):
        with self.database() as db:
            record = db.execute("SELECT * FROM folders WHERE id=?", (identifier,)).fetchone()
        if record is None:
            raise ValueError("Choose a registered image folder.")
        root = no_links(Path(record["path"]))
        if not root.is_dir():
            raise ValueError("The selected folder is unavailable.")
        return dict(record), root

    def forget_folder(self, identifier):
        with self.lock:
            if self.job and self.job["status"] == "running":
                raise ValueError("Stop the current image task before forgetting a folder.")
            if any(entry['image']['folder_id'] == identifier for entry in image_manager_trash.entries(self)):
                raise ValueError("Restore this folder's deleted images from Trash before forgetting it.")
            with self.database() as db:
                db.execute("DELETE FROM images WHERE folder_id=?", (identifier,))
                db.execute("DELETE FROM folders WHERE id=?", (identifier,))
        return {"ok": True}

    def image(self, identifier):
        with self.database() as db:
            row = db.execute("SELECT i.*,f.path AS folder_path FROM images i JOIN folders f ON f.id=i.folder_id WHERE i.id=?", (identifier,)).fetchone()
        if not row:
            raise ValueError("This image is no longer in the catalog.")
        result = dict(row)
        result["tags"] = json.loads(result["tags"])
        result["signature"] = json.loads(result["signature"])
        return result

    def image_path(self, identifier, *, unchanged=True):
        record = self.image(identifier)
        root = no_links(Path(record["folder_path"]))
        path = no_links(root / record["relative"])
        if not path.is_relative_to(root) or not path.is_file() or not record["available"]:
            raise ValueError("The image is missing or outside its registered folder. Scan again.")
        if unchanged and signature(path.stat()) != record["signature"]:
            raise ValueError("The image changed since its scan. Scan the folder again.")
        return record, path

    def query(self, *, folder_id="", search="", tag="", format="", month="", favorite=False, hide_tagged=False, tagged_only=False, visibility="visible", duplicates=False, digest="", sort="date", offset=0, limit=48):
        if sort not in ("date", "name", "size", "dimensions") or offset < 0 or not 1 <= limit <= 1000:
            raise ValueError("Invalid image page or sort order.")
        where = ["i.available=1"]
        if visibility not in ("visible", "hidden", "all"):
            raise ValueError("Invalid image visibility.")
        if visibility != "all":
            where.append("i.hidden=" + ("1" if visibility == "hidden" else "0"))
        params = []
        for field, value in [("folder_id", folder_id), ("format", format), ("sha256", digest)]:
            if value:
                where.append(f"i.{field}=?"); params.append(value)
        if search:
            where.append("(i.relative LIKE ? OR i.filter_tags LIKE ?)"); params.extend([f"%{search}%"] * 2)
        if not isinstance(tag, str) or len(tag) > 120:
            raise ValueError("Choose a tag or person name of up to 120 characters.")
        if tag:
            where.append("EXISTS (SELECT 1 FROM json_each(i.filter_tags) t WHERE t.value=?)"); params.append(tag)
        if month:
            where.append("substr(i.date,1,7)=?"); params.append(month)
        if favorite:
            where.append("i.favorite=1")
        if hide_tagged:
            where.append("json_array_length(i.filter_tags)=0")
        if tagged_only:
            where.append("json_array_length(i.filter_tags)>0")
        if duplicates:
            where.append("i.sha256 IN (SELECT sha256 FROM images WHERE available=1 AND sha256 IS NOT NULL GROUP BY sha256 HAVING COUNT(*)>1)")
        ordering = {"date": "i.date DESC", "name": "i.relative COLLATE NOCASE", "size": "i.bytes DESC", "dimensions": "(i.width*i.height) DESC"}[sort]
        predicate = " AND ".join(where)
        with self.database() as db:
            table, linked = visual_review_names.image_table(db)
            if len(tag) > 60 and not any(person['name'] == tag for entry in linked.values() for person in entry['people']):
                raise ValueError("Choose a saved person name or a tag of up to 60 characters.")
            total = db.execute(f"SELECT COUNT(*) FROM {table} i WHERE {predicate}", params).fetchone()[0]
            rows = db.execute(f"SELECT i.*,f.path AS folder_path FROM {table} i JOIN folders f ON f.id=i.folder_id WHERE {predicate} ORDER BY {ordering},i.id LIMIT ? OFFSET ?", [*params, limit, offset]).fetchall()
            months = [row[0] for row in db.execute("SELECT DISTINCT substr(date,1,7) FROM images WHERE available=1 ORDER BY 1 DESC")]
            formats = [row[0] for row in db.execute("SELECT DISTINCT format FROM images WHERE available=1 ORDER BY 1")]
            # Catalog-wide choices must not shrink with pagination or other filters.
            tags = [row[0] for row in db.execute(f"SELECT DISTINCT t.value FROM {table} i, json_each(i.filter_tags) t WHERE i.available=1 AND t.type='text' AND t.value<>'' ORDER BY t.value COLLATE NOCASE,t.value")]
        images = []
        for row in rows:
            item = dict(row)
            item['tags'] = json.loads(item.pop('filter_tags'))
            entry = linked.get(item['id'])
            item['person_tags'] = [person['name'] for person in entry['people']] if entry and entry['stamp'] == item['signature'] else []
            item['signature'] = json.loads(item['signature'])
            images.append(item)
        return {"images": images, "total": total, "offset": offset, "months": months, "formats": formats, "tags": tags}

    def metadata(self, identifiers, *, favorite=None, tags=None, add_tags=None, hidden=None):
        if not identifiers or len(identifiers) > MAX_PLAN or len(set(identifiers)) != len(identifiers):
            raise ValueError("Select 1–1,000 distinct images.")
        if favorite is not None and type(favorite) is not bool:
            raise ValueError("Invalid favorite value.")
        if hidden is not None and type(hidden) is not bool:
            raise ValueError("Invalid hidden value.")
        if tags is not None and add_tags is not None:
            raise ValueError("Choose either replacing tags or adding tags.")
        for values in (tags, add_tags):
            if values is not None and (not isinstance(values, list) or len(values) > 20 or any(not isinstance(tag, str) or not tag.strip() or len(tag) > 60 for tag in values)):
                raise ValueError("Use up to 20 tags, with 1–60 characters each.")
        with self.database() as db:
            tag_updates = {}
            for identifier in identifiers:
                record = db.execute("SELECT tags FROM images WHERE id=?", (identifier,)).fetchone()
                if record is None:
                    raise ValueError("A selected image is no longer in the catalog.")
                if tags is not None or add_tags is not None:
                    values = tags if tags is not None else [*json.loads(record["tags"]), *add_tags]
                    merged = list(dict.fromkeys(tag.strip() for tag in values))
                    if len(merged) > 20:
                        raise ValueError("An image would exceed 20 tags. Remove a tag before adding another; no images were updated.")
                    tag_updates[identifier] = json.dumps(merged)
            for identifier in identifiers:
                if favorite is not None:
                    db.execute("UPDATE images SET favorite=? WHERE id=?", (favorite, identifier))
                if identifier in tag_updates:
                    db.execute("UPDATE images SET tags=? WHERE id=?", (tag_updates[identifier], identifier))
                if hidden is not None:
                    db.execute("UPDATE images SET hidden=? WHERE id=?", (hidden, identifier))
        return {"ok": True}

    def hide_tagged(self, folder_id=""):
        # Catalog-only change across the whole folder, independent of page/selection.
        with self.database() as db:
            if folder_id and not db.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone():
                raise ValueError("Choose a registered image folder.")
            table, _ = visual_review_names.image_table(db)
            predicate = "available=1 AND hidden=0 AND json_array_length(filter_tags)>0"
            if folder_id:
                predicate += " AND folder_id=?"
            result = db.execute(f"UPDATE images SET hidden=1 WHERE id IN (SELECT id FROM {table} WHERE " + predicate + ")", (folder_id,) if folder_id else ())
            return {"ok": True, "updated": result.rowcount}

    def unhide_images(self, folder_id=""):
        # Restore the whole folder across pages without changing files or tags.
        with self.database() as db:
            if folder_id and not db.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone():
                raise ValueError("Choose a registered image folder.")
            predicate = "available=1 AND hidden=1"
            if folder_id:
                predicate += " AND folder_id=?"
            result = db.execute("UPDATE images SET hidden=0 WHERE " + predicate, (folder_id,) if folder_id else ())
            return {"ok": True, "updated": result.rowcount}

    def duplicates(self, folder_ids=None):
        predicate = " AND folder_id IN (" + ",".join("?" * len(folder_ids)) + ")" if folder_ids else ""
        with self.database() as db:
            groups = [dict(row) for row in db.execute("SELECT sha256,COUNT(*) AS count,MAX(bytes) AS bytes FROM images WHERE available=1 AND sha256 IS NOT NULL" + predicate + " GROUP BY sha256 HAVING COUNT(*)>1 ORDER BY MAX(bytes)*COUNT(*) DESC", folder_ids or [])]
        return groups

    def thumbnail(self, identifier, size=320):
        record, source = self.image_path(identifier)
        key = hashlib.sha256((identifier + json.dumps(record["signature"]) + str(size)).encode()).hexdigest()
        cache = self.directory / "thumbnails" / (key + ".jpg")
        if cache.is_file():
            return cache
        if record["width"] * record["height"] > MAX_PREVIEW_PIXELS or record["bytes"] > 256 * 1024 * 1024:
            raise ValueError("This image exceeds the preview limit (40 megapixels / 256 MiB).")
        with self.preview_slots:
            if cache.is_file():
                return cache
            cache.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache.with_suffix("." + uuid.uuid4().hex + ".tmp")
            try:
                with Image.open(source) as original:
                    original.draft("RGB", (size, size))
                    image = ImageOps.exif_transpose(original)
                    image.thumbnail((size, size))
                    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                        canvas = Image.new("RGB", image.size, "#161e29")
                        rgba = image.convert("RGBA"); canvas.paste(rgba, mask=rgba.getchannel("A")); image = canvas
                    else:
                        image = image.convert("RGB")
                    image.save(temporary, "JPEG", quality=84)
                # Recheck before publishing a thumbnail of a source that may have changed.
                self.image_path(identifier)
                temporary.replace(cache)
            finally:
                temporary.unlink(missing_ok=True)
        return cache

    def functions(self):
        with self.database() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT recipe FROM functions ORDER BY name COLLATE NOCASE")]

    def save_function(self, value):
        recipe = dict(value)
        if not isinstance(recipe.get("name"), str) or not recipe["name"].strip() or len(recipe["name"]) > 80:
            raise ValueError("Name the image function (up to 80 characters).")
        steps = recipe.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= 12 or any(step not in FUNCTION_STEPS for step in steps):
            raise ValueError("Choose 1–12 supported image-function steps.")
        self._validate_sources(recipe.get("folder_ids", []))
        if "plan" in steps:
            if recipe.get("layout") not in LAYOUTS or recipe.get("mode") not in ("copy", "move"):
                raise ValueError("Choose an organization layout and Copy or Move.")
        if "duplicate-plan" in steps:
            self._validate_duplicate_plan(recipe)
        if "report" in steps or "plan" in steps:
            self.folder(recipe.get("output_id"))
        if type(recipe.get("recursive", True)) is not bool:
            raise ValueError("Invalid subfolder setting.")
        recipe["id"] = recipe.get("id") or uuid.uuid4().hex
        if not isinstance(recipe["id"], str) or len(recipe["id"]) != 32 or any(char not in "0123456789abcdef" for char in recipe["id"]):
            raise ValueError("Invalid function ID.")
        recipe["name"] = recipe["name"].strip()
        with self.database() as db:
            db.execute("INSERT INTO functions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,recipe=excluded.recipe", (recipe["id"], recipe["name"], json.dumps(recipe)))
        return recipe

    def remove_function(self, identifier):
        with self.database() as db:
            db.execute("DELETE FROM functions WHERE id=?", (identifier,))
        return {"ok": True}

    def _validate_sources(self, identifiers):
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 100 or len(set(identifiers)) != len(identifiers):
            raise ValueError("Choose 1–100 source folders.")
        for identifier in identifiers:
            self.folder(identifier)
        return identifiers

    def state(self):
        trash_count = len(image_manager_trash.entries(self))
        with self.lock:
            job = json.loads(json.dumps(self.job)) if self.job else None
        with self.database() as db:
            summary = dict(db.execute("SELECT COUNT(*) AS images,COALESCE(SUM(bytes),0) AS bytes,COALESCE(SUM(favorite),0) AS favorites,COALESCE(SUM(hidden),0) AS hidden FROM images WHERE available=1").fetchone())
            receipts = [json.loads(row[0]) for row in db.execute("SELECT value FROM receipts ORDER BY rowid DESC LIMIT 10")]
            plans = []
            for row in db.execute("SELECT value FROM plans ORDER BY rowid DESC LIMIT 10"):
                plan = json.loads(row[0])
                plans.append({key: plan[key] for key in ("id", "created", "status", "mode", "destination") } | {"count": len(plan["entries"])})
        return {"job": job, "folders": self.folders(), "summary": {**summary, "trash": trash_count}, "functions": self.functions(), "duplicates": self.duplicates(), "receipts": receipts, "plans": plans}

    def trash(self):
        return {"entries": image_manager_trash.entries(self)}

    def review_trash(self, action, identifiers):
        return image_manager_trash.prepare(self, action, identifiers)

    def _check(self):
        if self.cancel.is_set():
            raise Stopped("Image task stopped. Completed catalog updates and verified transfers remain.")

    def _progress(self, **values):
        with self.lock:
            self.job.update(values)

    def start(self, kind, value):
        if kind not in ("scan", "duplicates", "plan", "duplicate-plan", "function", "apply", "report", "trash", "image-tools"):
            raise ValueError("Unknown image task.")
        payload = dict(value)
        if kind == 'image-tools':
            from .image_manager_tools import validate
            payload['image_options'] = validate(self, payload)
        if kind in ("scan", "duplicates", "report"):
            self._validate_sources(payload.get("folder_ids", []))
        if kind == "function":
            recipe = next((item for item in self.functions() if item["id"] == payload.get("function_id")), None)
            if not recipe:
                raise ValueError("Choose a saved image function.")
            payload = recipe
            self._validate_sources(payload["folder_ids"])
        if kind == "plan":
            self._validate_plan(payload)
        if kind == "duplicate-plan":
            self._validate_duplicate_plan(payload)
        if kind == "report":
            self.folder(payload.get("output_id"))
        if kind == "apply":
            plan = self.plan(payload.get("plan_id"))
            if plan["status"] != "ready" or payload.get("confirmation") != f"{plan['mode'].upper()} {len(plan['entries'])}":
                raise ValueError("Review the plan and use its confirmation button.")
        with self.lock:
            if self.job and self.job["status"] == "running":
                raise ValueError("An image task is already running.")
            if kind == 'trash': payload = image_manager_trash.consume(self, payload)
            self.cancel.clear()
            self.job = {"id": uuid.uuid4().hex, "kind": kind, "status": "running", "started": now(), "phase": kind,
                        "current": 0, "total": 0, "message": "Starting…", "result": {}, "steps": []}
            self.worker = threading.Thread(target=self._run, args=(kind, payload), daemon=True, name="image-manager")
            self.worker.start()
            return {"job_id": self.job["id"]}

    def stop(self, identifier):
        with self.lock:
            if not self.job or self.job["id"] != identifier:
                raise ValueError("This image task is no longer active.")
            self.cancel.set()
        return {"ok": True}

    def _run(self, kind, payload):
        result = {}
        try:
            steps = payload["steps"] if kind == "function" else [kind]
            self._progress(steps=[{"type": step, "status": "pending"} for step in steps])
            for index, step in enumerate(steps):
                self._check()
                with self.lock:
                    self.job["steps"][index]["status"] = "running"
                self._progress(phase=step, step=index + 1, current=0, total=0)
                if step == "scan": result["scan"] = self._scan(payload["folder_ids"], payload.get("recursive", True))
                elif step == "duplicates": result["duplicates"] = self._hash_duplicates(payload["folder_ids"])
                elif step == "plan":
                    request = {**payload}
                    if kind == "function": request["ids"] = self._scope_ids(payload["folder_ids"])
                    result["plan_id"] = self._prepare_plan(request)["id"]
                elif step == "duplicate-plan": result["plan_id"] = self._prepare_duplicate_plan(payload)["id"]
                elif step == "report": result["report"] = self._report(payload, result)
                elif step == "apply": result["receipt_id"] = self._apply(payload["plan_id"])
                elif step == "trash": result["receipt_id"] = image_manager_trash.execute(self, payload)
                elif step == "image-tools":
                    from .image_manager_tools import execute
                    result['image_tools'] = execute(self, payload)
                with self.lock:
                    self.job["steps"][index]["status"] = "complete"
                self._progress(result=result)
            self._check()
            self._progress(status="complete", message="Image task complete.", finished=now())
        except Exception as error:
            with self.lock:
                for entry in self.job["steps"]:
                    if entry["status"] == "running": entry["status"] = "stopped" if isinstance(error, Stopped) else "failed"
            self._progress(status="stopped" if isinstance(error, Stopped) else "failed", message=str(error), result=result, finished=now())

    def _upsert(self, db, folder_id, relative, path, metadata, stamp, *, favorite=0, tags=None):
        existing = db.execute("SELECT * FROM images WHERE key=?", (path_key(path),)).fetchone()
        same = existing and json.loads(existing["signature"]) == metadata["signature"]
        value = {"id": existing["id"] if existing else uuid.uuid4().hex, "folder_id": folder_id, "relative": relative,
                 "key": path_key(path), **{key: metadata[key] for key in ("bytes", "width", "height", "format", "date", "date_source")},
                 "signature": json.dumps(metadata["signature"]), "sha256": existing["sha256"] if same else None,
                 "favorite": existing["favorite"] if existing else favorite, "tags": existing["tags"] if existing else json.dumps(tags or []), "seen": stamp}
        db.execute("""INSERT INTO images(id,folder_id,relative,key,bytes,width,height,format,date,date_source,signature,sha256,available,favorite,tags,seen)
          VALUES(:id,:folder_id,:relative,:key,:bytes,:width,:height,:format,:date,:date_source,:signature,:sha256,1,:favorite,:tags,:seen)
          ON CONFLICT(key) DO UPDATE SET folder_id=excluded.folder_id,relative=excluded.relative,bytes=excluded.bytes,width=excluded.width,height=excluded.height,
          format=excluded.format,date=excluded.date,date_source=excluded.date_source,signature=excluded.signature,sha256=excluded.sha256,available=1,seen=excluded.seen""", value)
        return value["id"]

    def _scan(self, identifiers, recursive):
        if type(recursive) is not bool:
            raise ValueError("Invalid subfolder setting.")
        summary = {"visited": 0, "images": 0, "skipped": 0, "partial": False, "warnings": []}
        output_roots = [Path(folder["path"]) for folder in self.folders() if folder["purpose"] == "output"]
        for identifier in identifiers:
            self._check(); _, root = self.folder(identifier)
            stamp = uuid.uuid4().hex
            stack = [root]
            complete = True
            while stack:
                self._check(); directory = stack.pop()
                try:
                    no_links(directory)
                    with os.scandir(directory) as entries:
                        for entry in entries:
                            self._check(); summary["visited"] += 1
                            if summary["visited"] > self.scan_limit:
                                summary["partial"] = True; complete = False; stack.clear(); break
                            candidate = Path(entry.path)
                            if "nvidia" in entry.name.casefold() or entry.is_symlink() or candidate.is_junction():
                                summary["skipped"] += 1; continue
                            if entry.is_dir(follow_symlinks=False):
                                if any(candidate == output for output in output_roots):
                                    continue
                                if recursive and entry.name not in (".git", "node_modules", "venv", "__pycache__", image_manager_trash.TRASH_NAME):
                                    stack.append(candidate)
                                continue
                            if not entry.is_file(follow_symlinks=False) or candidate.suffix.lower() not in EXTENSIONS:
                                continue
                            try:
                                no_links(candidate)
                                metadata = image_metadata(candidate)
                                with self.database() as db: self._upsert(db, identifier, str(candidate.relative_to(root)), candidate, metadata, stamp)
                                summary["images"] += 1
                            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
                                summary["skipped"] += 1
                                if len(summary["warnings"]) < 100: summary["warnings"].append(f"{candidate.relative_to(root)}: {error}")
                            self._progress(current=summary["images"], message=f"Visited {summary['visited']} entries · {summary['images']} still images")
                except OSError as error:
                    complete = False
                    if len(summary["warnings"]) < 100: summary["warnings"].append(f"{directory}: {error}")
            # A bounded/inaccessible scan must never mark unvisited files missing.
            if complete:
                with self.database() as db:
                    if recursive: db.execute("UPDATE images SET available=0 WHERE folder_id=? AND seen!=?", (identifier, stamp))
                    else:
                        old = db.execute("SELECT id,relative FROM images WHERE folder_id=? AND seen!=?", (identifier, stamp)).fetchall()
                        for item in old:
                            if len(Path(item["relative"]).parts) == 1: db.execute("UPDATE images SET available=0 WHERE id=?", (item["id"],))
            if summary["partial"]: break
        return summary

    def _scope_ids(self, identifiers):
        placeholders = ",".join("?" * len(identifiers))
        with self.database() as db:
            return [row[0] for row in db.execute(f"SELECT id FROM images WHERE available=1 AND folder_id IN ({placeholders}) ORDER BY date,id", identifiers)]

    def _scope_records(self, identifiers):
        placeholders = ",".join("?" * len(identifiers))
        with self.database() as db:
            rows = db.execute(f"SELECT i.*,f.path AS folder_path FROM images i JOIN folders f ON f.id=i.folder_id WHERE i.available=1 AND i.folder_id IN ({placeholders}) ORDER BY i.date,i.id", identifiers).fetchall()
        records = []
        for row in rows:
            self._check()
            records.append({**dict(row), "tags": json.loads(row["tags"]), "signature": json.loads(row["signature"])})
        return records

    def _hash(self, path, expected=None):
        self._check(); no_links(path)
        before = path.stat()
        if expected is not None and signature(before) != expected:
            raise ValueError("An image changed since scanning. Scan again before proceeding.")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            if signature(os.fstat(stream.fileno())) != signature(before):
                raise ValueError("An image changed while opening it.")
            while chunk := stream.read(1024 * 1024):
                self._check(); digest.update(chunk)
        no_links(path)
        if signature(path.stat()) != signature(before):
            raise ValueError("An image changed during hashing.")
        return digest.hexdigest()

    def _hash_duplicates(self, identifiers):
        records = self._scope_records(identifiers)
        sizes = {}
        for record in records: sizes.setdefault(record["bytes"], []).append(record)
        candidates = [record for group in sizes.values() if len(group) > 1 for record in group]
        self._progress(total=len(candidates), message="Hashing files with matching byte sizes…")
        for index, record in enumerate(candidates):
            self._check(); _, source = self.image_path(record["id"])
            digest = self._hash(source, record["signature"])
            with self.database() as db: db.execute("UPDATE images SET sha256=? WHERE id=?", (digest, record["id"]))
            self._progress(current=index + 1, message=f"Hashed {index + 1} of {len(candidates)} candidate images")
        return {"hashed": len(candidates), "groups": self.duplicates(identifiers), "note": "Exact byte matches only. Similar-looking images are not classified as duplicates. Hardlinked paths may share physical disk storage."}

    def _validate_plan(self, payload):
        identifiers = payload.get("ids")
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= MAX_PLAN or len(set(identifiers)) != len(identifiers):
            raise ValueError("Select 1–1,000 images to organize. Larger folders need separate reviewed batches.")
        if payload.get("layout") not in LAYOUTS or payload.get("mode") not in ("copy", "move"):
            raise ValueError("Choose a valid organization layout and Copy or Move.")
        _, destination = self.folder(payload.get("output_id"))
        for identifier in identifiers:
            record, _ = self.image_path(identifier)
            source_root = Path(record["folder_path"])
            if destination.is_relative_to(source_root) or source_root.is_relative_to(destination):
                raise ValueError("Choose an output folder separate from the selected source folder trees.")
        return identifiers, destination

    def _prepare_plan(self, payload):
        identifiers, destination = self._validate_plan(payload)
        entries, reserved = [], set()
        self._progress(total=len(identifiers), message="Preparing exact paths and source hashes…")
        for index, identifier in enumerate(identifiers):
            self._check(); record, source = self.image_path(identifier)
            digest = self._hash(source, record["signature"])
            date = record["date"][:10].split("-")
            subfolder = Path(*date[:2]) if payload["layout"] == "month" else Path(*date) if payload["layout"] == "day" else Path(record["format"].lower()) if payload["layout"] == "format" else Path(record["relative"]).parent
            target = no_links(destination / subfolder / source.name)
            suffix = 2
            while target.exists() or path_key(target) in reserved:
                target = no_links(destination / subfolder / f"{source.stem} ({suffix}){source.suffix}"); suffix += 1
            reserved.add(path_key(target))
            if not target.is_relative_to(destination): raise ValueError("Invalid organization destination.")
            entries.append({"id": identifier, "source": str(source), "target": str(target), "bytes": record["bytes"], "sha256": digest,
                            "signature": record["signature"], "date_source": record["date_source"]})
            self._progress(current=index + 1)
        plan = {"id": uuid.uuid4().hex, "created": now(), "status": "ready", "mode": payload["mode"], "layout": payload["layout"],
                "output_id": payload["output_id"], "destination": str(destination), "entries": entries}
        with self.database() as db: db.execute("INSERT INTO plans VALUES(?,?)", (plan["id"], json.dumps(plan)))
        return plan

    def _validate_duplicate_plan(self, payload):
        identifiers = self._validate_sources(payload.get("folder_ids", []))
        if len(identifiers) != 1:
            raise ValueError("Choose one source folder for a duplicate-folder plan.")
        folder, root = self.folder(identifiers[0])
        if folder["purpose"] != "source":
            raise ValueError("Choose a source image folder, not an output folder.")
        if payload.get("mode") not in ("copy", "move") or payload.get("duplicate_members", "extra") not in ("extra", "all"):
            raise ValueError("Choose Copy or Move and which duplicate group members to file.")
        offset = payload.get("duplicate_offset", 0)
        if type(offset) is not int or not 0 <= offset <= self.scan_limit:
            raise ValueError("Choose a valid duplicate batch offset.")
        destination = no_links(root / "Duplicates")
        if destination.exists() and not destination.is_dir():
            raise ValueError("The Duplicates destination is occupied by a file.")
        with self.database() as db:
            registered = db.execute("SELECT purpose FROM folders WHERE key=?", (path_key(destination),)).fetchone()
        if registered and registered["purpose"] != "output":
            raise ValueError("The Duplicates folder is registered as a source. Forget that catalog folder before using it as an output.")
        return root, destination

    def _prepare_duplicate_plan(self, payload):
        root, destination = self._validate_duplicate_plan(payload)
        # Fresh full-content checks: never move based on a stale catalog hash.
        self._hash_duplicates(payload["folder_ids"])
        groups = {}
        for record in self._scope_records(payload["folder_ids"]):
            self._check()
            source = root / record["relative"]
            if record["sha256"] and not source.is_relative_to(destination):
                groups.setdefault(record["sha256"], []).append(record)
        matching = [(digest, sorted(records, key=lambda row: (row["relative"].casefold(), row["id"])))
                    for digest, records in sorted(groups.items()) if len(records) > 1]
        members = payload.get("duplicate_members", "extra")
        count = sum(len(records) if members == "all" else len(records) - 1 for _, records in matching)
        if not count:
            raise ValueError("No exact duplicates were found outside this folder's Duplicates destination. Scan the source folder first.")
        offset = payload.get("duplicate_offset", 0)
        candidates = [record["id"] for _, records in matching for record in (records if members == "all" else records[1:])]
        selected_ids = set(candidates[offset:offset + MAX_PLAN])
        if not selected_ids:
            raise ValueError("This duplicate batch is no longer available. Prepare the first batch again.")
        entries, kept, kept_records, reserved = [], [], [], set()
        self._progress(total=len(selected_ids), current=0, message="Preparing the duplicate-folder plan…")
        for digest, records in matching:
            if not any(record["id"] in selected_ids for record in records): continue
            if members == "extra":
                record, source = self.image_path(records[0]["id"])
                kept.append(str(source))
                kept_records.append({"id": record["id"], "source": str(source), "signature": record["signature"], "sha256": digest})
            for record in records if members == "all" else records[1:]:
                if record["id"] not in selected_ids: continue
                self._check(); record, source = self.image_path(record["id"])
                target = no_links(destination / digest[:12] / Path(record["relative"]))
                base = target; suffix = 2
                while target.exists() or path_key(target) in reserved:
                    target = no_links(base.with_name(f"{base.stem} ({suffix}){base.suffix}")); suffix += 1
                reserved.add(path_key(target))
                if not target.is_relative_to(destination): raise ValueError("Invalid duplicate destination.")
                entries.append({"id": record["id"], "source": str(source), "target": str(target), "bytes": record["bytes"],
                                "sha256": digest, "signature": record["signature"], "date_source": record["date_source"]})
                self._progress(current=len(entries))
        self._check(); no_links(destination)
        # Creating/registering the empty output is reversible; image transfers
        # still require reviewing and applying the exact plan below.
        destination.mkdir(exist_ok=True)
        output = self.add_folder(str(destination), "output")
        plan = {"id": uuid.uuid4().hex, "created": now(), "status": "ready", "kind": "duplicates", "mode": payload["mode"],
                "layout": "duplicate-groups", "duplicate_members": members, "source_folder_id": payload["folder_ids"][0],
                "duplicate_offset": offset, "duplicate_total": count, "duplicate_remaining": max(0, count - offset - len(entries)),
                "output_id": output["id"], "destination": str(destination), "kept": kept, "kept_records": kept_records, "entries": entries}
        with self.database() as db: db.execute("INSERT INTO plans VALUES(?,?)", (plan["id"], json.dumps(plan)))
        return plan

    def plan(self, identifier):
        with self.database() as db: row = db.execute("SELECT value FROM plans WHERE id=?", (identifier,)).fetchone()
        if not row: raise ValueError("The organization plan is unavailable. Prepare it again.")
        return json.loads(row[0])

    def _write_plan(self, plan):
        with self.database() as db: db.execute("UPDATE plans SET value=? WHERE id=?", (json.dumps(plan), plan["id"]))

    def _receipt(self, receipt):
        with self.database() as db: db.execute("INSERT INTO receipts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (receipt["id"], json.dumps(receipt)))

    def _apply(self, identifier):
        plan = self.plan(identifier)
        if plan["status"] != "ready": raise ValueError("This plan has already been used. Prepare a new plan for remaining files.")
        _, destination = self.folder(plan["output_id"])
        # All paths and source hashes are checked before the first output write.
        for retained in plan.get("kept_records", []):
            self._check(); _, source = self.image_path(retained["id"])
            if str(source) != retained["source"] or self._hash(source, retained["signature"]) != retained["sha256"]:
                raise ValueError("An original that would be kept changed. Prepare the duplicate plan again.")
        for entry in plan["entries"]:
            self._check(); _, source = self.image_path(entry["id"])
            target = no_links(Path(entry["target"]))
            if str(source) != entry["source"] or not target.is_relative_to(destination) or target.exists():
                raise ValueError("A planned path changed or is now occupied. Prepare the plan again.")
            if self._hash(source, entry["signature"]) != entry["sha256"]:
                raise ValueError("Source contents changed after the plan. Prepare a new plan.")
        plan["status"] = "used"; self._write_plan(plan)
        receipt = {"id": uuid.uuid4().hex, "plan_id": identifier, "mode": plan["mode"], "started": now(), "status": "running", "entries": []}
        self._receipt(receipt); self._progress(total=len(plan["entries"]), message="Transferring verified images…")
        try:
            for index, entry in enumerate(plan["entries"]):
                self._check(); record, source = self.image_path(entry["id"])
                target = no_links(Path(entry["target"]))
                no_links(destination)
                target.parent.mkdir(parents=True, exist_ok=True)
                no_links(target.parent)
                row = {**entry, "status": "pending"}; receipt["entries"].append(row); self._receipt(receipt)
                created_signature = None
                try:
                    with target.open("xb") as output:
                        created_signature = signature(os.fstat(output.fileno()))
                        row["status"] = "writing"; self._receipt(receipt)
                        digest = hashlib.sha256()
                        with source.open("rb") as stream:
                            if signature(os.fstat(stream.fileno())) != entry["signature"]: raise ValueError("Source changed before transfer.")
                            while chunk := stream.read(1024 * 1024):
                                self._check(); output.write(chunk); digest.update(chunk)
                        output.flush(); os.fsync(output.fileno())
                    if digest.hexdigest() != entry["sha256"] or self._hash(target) != entry["sha256"]:
                        raise ValueError("Copied image did not pass SHA-256 verification.")
                    row["status"] = "verified copy; source retained"; self._receipt(receipt)
                    # Preserve timestamps without modifying original bytes/metadata.
                    shutil.copystat(source, target, follow_symlinks=False)
                    if plan["mode"] == "move":
                        self._check()
                        self.image_path(entry["id"])
                        if self._hash(source, entry["signature"]) != entry["sha256"]: raise ValueError("Source changed; original was retained.")
                        # Catalog update must succeed before unlinking the selected original.
                        target_metadata = image_metadata(target)
                        with self.database() as db:
                            db.execute("UPDATE images SET folder_id=?,relative=?,key=?,signature=?,sha256=? WHERE id=?", (plan["output_id"], str(target.relative_to(destination)), path_key(target), json.dumps(target_metadata["signature"]), entry["sha256"], entry["id"]))
                        source.unlink()
                        row["status"] = "moved"
                    else:
                        metadata = image_metadata(target)
                        with self.database() as db:
                            saved = self._upsert(db, plan["output_id"], str(target.relative_to(destination)), target, metadata, now(), favorite=record["favorite"], tags=record["tags"])
                            db.execute("UPDATE images SET sha256=? WHERE id=?", (entry["sha256"], saved))
                        row["status"] = "copied"
                except BaseException as error:
                    # Remove only an incomplete file created by this operation;
                    # verified copies are retained if a later step fails/stops.
                    if row["status"] in ("pending", "writing") and created_signature is not None and target.exists():
                        info = target.lstat()
                        if stat.S_ISREG(info.st_mode) and [info.st_dev, info.st_ino] == created_signature[2:]: target.unlink()
                    row["error"] = str(error); self._receipt(receipt); raise
                self._receipt(receipt); self._progress(current=index + 1, message=f"{plan['mode'].title()} verified: {index + 1} of {len(plan['entries'])}")
            receipt["status"] = "complete"
            return receipt["id"]
        except BaseException:
            receipt["status"] = "stopped" if self.cancel.is_set() else "failed"
            raise
        finally:
            receipt["finished"] = now(); self._receipt(receipt)

    def _report(self, payload, result):
        _, output = self.folder(payload["output_id"])
        report = {"created": now(), "kind": "still-image-manager", "folders": [self.folder(identifier)[0] for identifier in payload["folder_ids"]],
                  "images": self._scope_records(payload["folder_ids"]), "duplicates": self.duplicates(payload["folder_ids"]), "function_results": result,
                  "note": "Catalog snapshot; exact duplicate hashes are available only for checked images. No files are moved by reporting."}
        if result.get("plan_id"): report["plan"] = self.plan(result["plan_id"])
        self._check(); no_links(output)
        target = output / f"image-manager-report-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}.json"
        with target.open("x", encoding="utf-8") as stream: json.dump(report, stream, ensure_ascii=False, indent=2)
        return str(target)


manager = ImageManager()
