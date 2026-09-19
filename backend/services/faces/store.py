"""Face datasets on disk. Follows the image library's atomic-JSON pattern.

Records, crops and embeddings are three files per dataset rather than rows in
the SQLite memory database: the image side of this app already stores owned
media this way, and it keeps a dataset copyable and inspectable on its own.
"""
from __future__ import annotations

import json
import hashlib
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from config import settings
from services.faces.crops import DEFAULT_MODE, MODES, SIZES
from services.image_library import atomic, identity

ROOT = settings.data_dir / "face_datasets"
LOCK = threading.RLock()
DIMENSIONS = 512
MAX_FACES = 20000
STATES = ("pending", "accepted", "rejected")
DEFAULT_SETTINGS = {
    "crop_mode": DEFAULT_MODE,
    "padding": 0.0,
    "size": 512,
    "detect_threshold": 0.5,
    "min_confidence": 0.6,
    "min_face_pixels": 48,
    "min_sharpness": 12.0,
    "duplicate_threshold": 0.97,
    "similar_threshold": 0.45,
}


def now():
    return datetime.now(timezone.utc).isoformat()


def dataset_dir(dataset_id):
    return ROOT / identity(dataset_id)


def _read(dataset_id):
    path = dataset_dir(dataset_id) / "dataset.json"
    if not path.is_file():
        raise ValueError("Face dataset no longer exists")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1:
        raise ValueError("Face dataset is unreadable. Its files were preserved.")
    data["settings"] = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    return data


def _write(data):
    data["updated_at"] = now()
    atomic(dataset_dir(data["id"]) / "dataset.json", json.dumps(data, ensure_ascii=False).encode())
    return data


def vectors(dataset_id):
    path = dataset_dir(dataset_id) / "embeddings.npy"
    if not path.is_file():
        return np.zeros((0, DIMENSIONS), dtype=np.float32)
    try:
        loaded = np.load(path)
    except (OSError, ValueError):
        return np.zeros((0, DIMENSIONS), dtype=np.float32)
    if loaded.ndim != 2 or loaded.shape[1] != DIMENSIONS:
        return np.zeros((0, DIMENSIONS), dtype=np.float32)
    return loaded.astype(np.float32, copy=False)


def _write_vectors(dataset_id, matrix):
    import io
    buffer = io.BytesIO()
    np.save(buffer, matrix.astype(np.float32, copy=False))
    atomic(dataset_dir(dataset_id) / "embeddings.npy", buffer.getvalue())


# --- datasets ------------------------------------------------------------

def list_datasets():
    with LOCK:
        if not ROOT.is_dir():
            return []
        found = []
        for path in ROOT.glob("*/dataset.json"):
            try:
                data = _read(path.parent.name)
            except (ValueError, OSError):
                continue
            faces = data.get("faces", [])
            found.append({
                "id": data["id"], "name": data["name"], "created_at": data["created_at"],
                "updated_at": data.get("updated_at", data["created_at"]),
                "face_count": len(faces),
                "accepted": sum(1 for face in faces if face["state"] == "accepted"),
                "rejected": sum(1 for face in faces if face["state"] == "rejected"),
                "source_count": len({face["source_sha256"] for face in faces}),
                "settings": data["settings"],
            })
        return sorted(found, key=lambda item: item["updated_at"], reverse=True)


def create_dataset(name):
    name = (name or "").strip() or "Face dataset"
    if len(name) > 120:
        raise ValueError("Dataset names are at most 120 characters")
    with LOCK:
        data = {"version": 1, "id": uuid.uuid4().hex, "name": name, "created_at": now(),
                "settings": dict(DEFAULT_SETTINGS), "faces": [], "sources": []}
        (dataset_dir(data["id"]) / "crops").mkdir(parents=True, exist_ok=True)
        return _write(data)


def get_dataset(dataset_id):
    with LOCK:
        return _read(dataset_id)


def source_path(dataset_id, source_id):
    root = dataset_dir(dataset_id).resolve()
    target = (root / "sources" / f"{identity(source_id)}.image").resolve()
    if not target.is_relative_to(root):
        raise ValueError("Source image escapes its face dataset")
    return target


def save_source(dataset_id, data, name):
    """One owned original for re-cropping, rather than base64 in every face row."""
    source_id = hashlib.sha256(data).hexdigest()[:32]
    with LOCK:
        _read(dataset_id)
        target = source_path(dataset_id, source_id)
        if not target.exists():
            atomic(target, data)
    return {"kind": "face-upload", "dataset_id": dataset_id, "id": source_id, "name": name}


def rename_dataset(dataset_id, name):
    name = (name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("Dataset names need 1-120 characters")
    with LOCK:
        data = _read(dataset_id)
        data["name"] = name
        return _write(data)


def delete_dataset(dataset_id):
    import shutil
    with LOCK:
        _read(dataset_id)
        shutil.rmtree(dataset_dir(dataset_id), ignore_errors=True)


def update_settings(dataset_id, changes):
    with LOCK:
        data = _read(dataset_id)
        merged = dict(data["settings"])
        for key, value in (changes or {}).items():
            if key not in DEFAULT_SETTINGS:
                raise ValueError(f"Unknown face setting '{key}'")
            merged[key] = value
        if merged["crop_mode"] not in MODES:
            raise ValueError("Choose a supported crop mode")
        if int(merged["size"]) not in SIZES:
            raise ValueError("Choose a supported output size")
        merged["size"] = int(merged["size"])
        for key, low, high in (("padding", -0.5, 1.5), ("detect_threshold", 0.1, 0.95),
                               ("min_confidence", 0.0, 1.0), ("duplicate_threshold", 0.5, 1.0),
                               ("similar_threshold", 0.0, 1.0)):
            merged[key] = float(np.clip(float(merged[key]), low, high))
        merged["min_face_pixels"] = int(np.clip(int(merged["min_face_pixels"]), 0, 4096))
        merged["min_sharpness"] = float(np.clip(float(merged["min_sharpness"]), 0.0, 10000.0))
        data["settings"] = merged
        return _write(data)


# --- faces ---------------------------------------------------------------

def add_faces(dataset_id, records, embeddings, source):
    """Append one source image's faces. Crops are written before the index."""
    with LOCK:
        data = _read(dataset_id)
        if len(data["faces"]) + len(records) > MAX_FACES:
            raise ValueError(f"A dataset holds at most {MAX_FACES} faces")
        matrix = vectors(dataset_id)
        rows = [] if not len(embeddings) else list(np.asarray(embeddings, dtype=np.float32))
        base = matrix.shape[0]
        for offset, record in enumerate(records):
            record["embedding_row"] = base + offset
        matrix = np.concatenate([matrix, np.asarray(rows, dtype=np.float32).reshape(-1, DIMENSIONS)]) \
            if rows else matrix
        _write_vectors(dataset_id, matrix)
        data["faces"].extend(records)
        if not any(item["sha256"] == source["sha256"] for item in data["sources"]):
            data["sources"].append(source)
        return _write(data)


def set_state(dataset_id, face_ids, state):
    if state not in STATES:
        raise ValueError("Face state must be pending, accepted, or rejected")
    wanted = set(face_ids or [])
    with LOCK:
        data = _read(dataset_id)
        changed = 0
        for face in data["faces"]:
            if face["id"] in wanted:
                face["state"] = state
                changed += 1
        _write(data)
        return {"changed": changed, "state": state}


def remove_faces(dataset_id, face_ids):
    """Delete face records and their crops. Source images are never touched."""
    wanted = set(face_ids or [])
    with LOCK:
        data = _read(dataset_id)
        keep = [face for face in data["faces"] if face["id"] not in wanted]
        matrix = vectors(dataset_id)
        rebuilt = []
        for position, face in enumerate(keep):
            row = face.get("embedding_row")
            rebuilt.append(matrix[row] if row is not None and row < matrix.shape[0]
                           else np.zeros(DIMENSIONS, dtype=np.float32))
            face["embedding_row"] = position
        _write_vectors(dataset_id, np.asarray(rebuilt, dtype=np.float32).reshape(-1, DIMENSIONS))
        for face_id in wanted:
            (dataset_dir(dataset_id) / "crops" / f"{identity(face_id)}.png").unlink(missing_ok=True)
        removed = len(data["faces"]) - len(keep)
        data["faces"] = keep
        _write(data)
        return {"removed": removed}


def crop_path(dataset_id, face_id):
    path = dataset_dir(dataset_id) / "crops" / f"{identity(face_id)}.png"
    if not path.is_file():
        raise ValueError("Face crop no longer exists")
    return path


# --- similarity ----------------------------------------------------------

def similarity_to(dataset_id, reference_id):
    """Cosine similarity of every face to one reference, as {face_id: score}."""
    with LOCK:
        data = _read(dataset_id)
        matrix = vectors(dataset_id)
        reference = next((face for face in data["faces"] if face["id"] == reference_id), None)
        if reference is None:
            raise ValueError("Reference face no longer exists")
        row = reference.get("embedding_row")
        if row is None or row >= matrix.shape[0]:
            raise ValueError("That face has no embedding to compare")
        scores = matrix @ matrix[row]
        return {face["id"]: float(scores[face["embedding_row"]])
                for face in data["faces"]
                if face.get("embedding_row") is not None and face["embedding_row"] < matrix.shape[0]}


def cluster(dataset_id, threshold=None):
    """Greedy agglomerative grouping on cosine distance.

    Deliberately simple and dependency-free: it groups faces that look alike and
    never claims two faces are the same person.
    """
    with LOCK:
        data = _read(dataset_id)
        limit = float(data["settings"]["similar_threshold"] if threshold is None else threshold)
        matrix = vectors(dataset_id)
        faces = [face for face in data["faces"]
                 if face.get("embedding_row") is not None and face["embedding_row"] < matrix.shape[0]]
        centroids, members = [], []
        for face in faces:
            vector = matrix[face["embedding_row"]]
            best, score = -1, limit
            for index, centroid in enumerate(centroids):
                value = float(centroid @ vector / max(np.linalg.norm(centroid), 1e-9))
                if value >= score:
                    best, score = index, value
            if best < 0:
                centroids.append(vector.copy())
                members.append([face["id"]])
                face["cluster"] = len(centroids) - 1
            else:
                members[best].append(face["id"])
                centroids[best] += vector
                face["cluster"] = best
        # An outlier is a cluster of one: nothing else in the dataset matched it.
        for face in faces:
            face["outlier"] = len(members[face["cluster"]]) == 1
        _write(data)
        return {"clusters": len(centroids), "sizes": [len(group) for group in members],
                "outliers": sum(1 for group in members if len(group) == 1)}


def mark_duplicates(dataset_id, threshold=None):
    """Flag near-identical faces, keeping the sharpest of each group."""
    with LOCK:
        data = _read(dataset_id)
        limit = float(data["settings"]["duplicate_threshold"] if threshold is None else threshold)
        matrix = vectors(dataset_id)
        faces = [face for face in data["faces"]
                 if face.get("embedding_row") is not None and face["embedding_row"] < matrix.shape[0]]
        order = sorted(faces, key=lambda face: -face["metrics"].get("sharpness", 0))
        keepers = []
        duplicates = 0
        for face in faces:
            face["duplicate_of"] = None
        for face in order:
            vector = matrix[face["embedding_row"]]
            match = next((keeper for keeper in keepers
                          if float(matrix[keeper["embedding_row"]] @ vector) >= limit), None)
            if match is None:
                keepers.append(face)
            else:
                face["duplicate_of"] = match["id"]
                duplicates += 1
        _write(data)
        return {"duplicates": duplicates, "unique": len(keepers)}
