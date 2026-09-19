"""Character profiles built on top of face datasets.

A profile is a curated *reference* to faces that already live in a dataset:
it stores ids, never a second copy of a crop. Deleting a character therefore
costs nothing and never touches the extracted images.
"""
from __future__ import annotations

import json
import threading
import uuid

import numpy as np

from config import settings
from services.faces import store
from services.image_library import atomic, identity

ROOT = settings.data_dir / "face_bank"
LOCK = threading.RLock()
# Members are keyed by face id alone. The pipeline mints those as uuid4, so they
# are unique across datasets, which lets one character draw on several datasets
# while curation still addresses a face by a single id.
MAX_MEMBERS = 5000
MEMBER_STATES = ("accepted", "rejected")
# Below this the mean vector is too short to point anywhere meaningful: the
# members disagree so much that a centroid would be an artefact, not a summary.
MIN_MEAN_NORM = 0.15
DRIFT_MARGIN = 0.12


def _path(character_id):
    return ROOT / f"{identity(character_id)}.json"


def _read(character_id):
    path = _path(character_id)
    if not path.is_file():
        raise ValueError("Character profile no longer exists")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1:
        raise ValueError("Character profile is unreadable. Its file was preserved.")
    return data


def _write(data):
    data["updated_at"] = store.now()
    atomic(_path(data["id"]), json.dumps(data, ensure_ascii=False).encode())
    return data


def _clean_tags(tags):
    cleaned = []
    for tag in tags or []:
        text = str(tag).strip()[:60]
        if text and text.casefold() not in {item.casefold() for item in cleaned}:
            cleaned.append(text)
    if len(cleaned) > 40:
        raise ValueError("A character takes at most 40 tags")
    return cleaned


# --- embeddings ----------------------------------------------------------

def member_vectors(members):
    """Look up each member's stored embedding, grouped by dataset.

    Faces removed from their dataset since the profile was made are reported
    as missing rather than silently dropped, so curation can fix them.
    """
    vectors, present, missing = {}, [], []
    by_dataset: dict[str, list[dict]] = {}
    for member in members:
        by_dataset.setdefault(member["dataset_id"], []).append(member)
    for dataset_id, group in by_dataset.items():
        try:
            dataset = store.get_dataset(dataset_id)
            matrix = store.vectors(dataset_id)
        except (ValueError, OSError):
            missing.extend(group)
            continue
        rows = {face["id"]: face.get("embedding_row") for face in dataset["faces"]}
        details = {face["id"]: face for face in dataset["faces"]}
        for member in group:
            row = rows.get(member["face_id"])
            if row is None or row >= matrix.shape[0]:
                missing.append(member)
                continue
            vectors[member["face_id"]] = matrix[row]
            present.append({**member, "face": details[member["face_id"]]})
    return vectors, present, missing


def compute_centroid(vectors):
    """Mean of unit embeddings, renormalized.

    Every embedding is already L2-normalized, so the renormalized mean is the
    direction the group points in and cosine against it is a similarity. When
    the members disagree enough that the mean nearly cancels, there is no
    meaningful centre and that is reported instead of returned as a number.
    """
    if not len(vectors):
        return None
    matrix = np.asarray(vectors, dtype=np.float32).reshape(-1, store.DIMENSIONS)
    mean = matrix.mean(axis=0)
    norm = float(np.linalg.norm(mean))
    if norm < MIN_MEAN_NORM:
        return {"vector": None, "mean_norm": round(norm, 4), "source_count": int(matrix.shape[0]),
                "coherence": None, "usable": False,
                "detail": "These faces point in too many directions to have a meaningful centre. "
                          "Curate the group before relying on a representative face."}
    unit = mean / norm
    similarities = matrix @ unit
    return {
        "vector": [round(float(value), 6) for value in unit],
        "dimensions": store.DIMENSIONS,
        "mean_norm": round(norm, 4),
        "source_count": int(matrix.shape[0]),
        "coherence": round(float(similarities.mean()), 4),
        "spread": round(float(similarities.std()), 4),
        "usable": True,
        "detail": "Centroid of the accepted faces. It identifies the most representative real crop; "
                  "it is not a generated or averaged image.",
        "computed_at": store.now(),
    }


def _refresh(data):
    """Recompute centroid, per-member similarity and the representative face."""
    # The centroid is built from accepted faces only, but every member is then
    # scored against it -- including rejected ones, so it is obvious how far a
    # face sits before deciding whether to restore it.
    all_vectors, _, missing = member_vectors(data["members"])
    accepted = [member for member in data["members"]
                if member["state"] == "accepted" and member["face_id"] in all_vectors]
    centroid = compute_centroid([all_vectors[member["face_id"]] for member in accepted])
    data["centroid"] = centroid
    data["missing_members"] = [{"dataset_id": item["dataset_id"], "face_id": item["face_id"]} for item in missing]
    scores = {}
    if centroid and centroid.get("usable"):
        unit = np.asarray(centroid["vector"], dtype=np.float32)
        scores = {face_id: round(float(vector @ unit), 4) for face_id, vector in all_vectors.items()}
        best = max((member["face_id"] for member in accepted), key=lambda face_id: scores[face_id])
        data["representative_face_id"] = best
        data["representative_dataset_id"] = next(m["dataset_id"] for m in accepted if m["face_id"] == best)
        # Drift is judged relative to this group's own coherence, so a naturally
        # varied character is not flagged as heavily as a tight one.
        limit = max(0.0, float(centroid["coherence"]) - max(DRIFT_MARGIN, float(centroid["spread"])))
        data["drift_threshold"] = round(limit, 4)
    else:
        data["representative_face_id"] = None
        data["representative_dataset_id"] = None
        data["drift_threshold"] = None
    for member in data["members"]:
        member["similarity"] = scores.get(member["face_id"])
        member["drift"] = bool(
            data["drift_threshold"] is not None and member["state"] == "accepted"
            and member["similarity"] is not None and member["similarity"] < data["drift_threshold"])
    return data


# --- profiles ------------------------------------------------------------

def list_characters():
    with LOCK:
        if not ROOT.is_dir():
            return []
        found = []
        for path in sorted(ROOT.glob("*.json")):
            try:
                data = _read(path.stem)
            except (ValueError, OSError):
                continue
            accepted = [m for m in data["members"] if m["state"] == "accepted"]
            found.append({
                "id": data["id"], "name": data["name"], "tags": data["tags"],
                "notes": data["notes"], "created_at": data["created_at"],
                "updated_at": data["updated_at"],
                "reference_count": len(accepted),
                "rejected_count": len(data["members"]) - len(accepted),
                "datasets": sorted({m["dataset_id"] for m in data["members"]}),
                "representative_face_id": data.get("representative_face_id"),
                "representative_dataset_id": data.get("representative_dataset_id"),
                "primary_reference": data.get("primary_reference"),
                "coherence": (data.get("centroid") or {}).get("coherence"),
            })
        return sorted(found, key=lambda item: item["updated_at"], reverse=True)


def create_character(name, dataset_id=None, face_ids=(), notes="", tags=()):
    name = (name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("Character names need 1-120 characters")
    with LOCK:
        if any(item["name"].casefold() == name.casefold() for item in list_characters()):
            raise ValueError("A character already has that name")
        data = {
            "version": 1, "id": uuid.uuid4().hex, "name": name,
            "notes": str(notes or "")[:10000], "tags": _clean_tags(tags),
            "members": [], "primary_reference": None, "additional_references": [],
            "centroid": None, "representative_face_id": None, "representative_dataset_id": None,
            "created_at": store.now(),
        }
        ROOT.mkdir(parents=True, exist_ok=True)
        if dataset_id and face_ids:
            data["members"] = _new_members(dataset_id, face_ids, set())
        return _write(_refresh(data))


def _new_members(dataset_id, face_ids, existing):
    dataset = store.get_dataset(dataset_id)
    known = {face["id"] for face in dataset["faces"]}
    unknown = [face_id for face_id in face_ids if face_id not in known]
    if unknown:
        raise ValueError("Some chosen faces are not in that dataset")
    return [{"dataset_id": dataset_id, "face_id": face_id, "state": "accepted",
             "added_at": store.now()}
            for face_id in dict.fromkeys(face_ids) if face_id not in existing]


def get_character(character_id):
    with LOCK:
        return _refresh(_read(character_id))


def update_character(character_id, *, name=None, notes=None, tags=None):
    with LOCK:
        data = _read(character_id)
        if name is not None:
            cleaned = name.strip()
            if not cleaned or len(cleaned) > 120:
                raise ValueError("Character names need 1-120 characters")
            if any(item["name"].casefold() == cleaned.casefold() and item["id"] != character_id
                   for item in list_characters()):
                raise ValueError("A character already has that name")
            data["name"] = cleaned
        if notes is not None:
            data["notes"] = str(notes)[:10000]
        if tags is not None:
            data["tags"] = _clean_tags(tags)
        return _write(_refresh(data))


def delete_character(character_id):
    with LOCK:
        _read(character_id)
        # Only the profile is removed; the faces stay in their dataset.
        _path(character_id).unlink(missing_ok=True)


def add_members(character_id, dataset_id, face_ids):
    with LOCK:
        data = _read(character_id)
        existing = {member["face_id"] for member in data["members"]}
        additions = _new_members(dataset_id, face_ids, existing)
        if len(data["members"]) + len(additions) > MAX_MEMBERS:
            raise ValueError(f"A character holds at most {MAX_MEMBERS} reference faces")
        data["members"].extend(additions)
        return _write(_refresh(data))


def set_member_state(character_id, face_ids, state):
    """Accept, reject or restore. Never deletes: a rejected face stays listed."""
    if state not in MEMBER_STATES:
        raise ValueError("Member state must be accepted or rejected")
    wanted = set(face_ids or [])
    with LOCK:
        data = _read(character_id)
        changed = 0
        for member in data["members"]:
            if member["face_id"] in wanted and member["state"] != state:
                member["state"] = state
                changed += 1
        if state == "rejected":
            # A rejected face must not keep standing as the chosen reference.
            if data["primary_reference"] in wanted:
                data["primary_reference"] = None
            data["additional_references"] = [item for item in data["additional_references"]
                                             if item not in wanted]
        _write(_refresh(data))
        return {"changed": changed, "state": state}


def remove_members(character_id, face_ids):
    wanted = set(face_ids or [])
    with LOCK:
        data = _read(character_id)
        before = len(data["members"])
        data["members"] = [member for member in data["members"] if member["face_id"] not in wanted]
        if data["primary_reference"] in wanted:
            data["primary_reference"] = None
        data["additional_references"] = [item for item in data["additional_references"] if item not in wanted]
        _write(_refresh(data))
        return {"removed": before - len(data["members"])}


def move_members(character_id, target_id, face_ids):
    """Move curated faces to another character, keeping their state."""
    if character_id == target_id:
        raise ValueError("Choose a different character to move faces into")
    wanted = set(face_ids or [])
    with LOCK:
        source = _read(character_id)
        target = _read(target_id)
        moving = [member for member in source["members"] if member["face_id"] in wanted]
        if not moving:
            raise ValueError("None of those faces are in this character")
        held = {member["face_id"] for member in target["members"]}
        target["members"].extend({**member, "added_at": store.now()}
                                 for member in moving if member["face_id"] not in held)
        source["members"] = [member for member in source["members"] if member["face_id"] not in wanted]
        if source["primary_reference"] in wanted:
            source["primary_reference"] = None
        source["additional_references"] = [item for item in source["additional_references"] if item not in wanted]
        _write(_refresh(source))
        _write(_refresh(target))
        return {"moved": len(moving), "from": character_id, "to": target_id}


def set_reference(character_id, face_id, role):
    """Mark a face as the primary or an additional reference, or clear it.

    This is a deliberate human choice and is kept separate from the computed
    representative face, which changes whenever the group is curated.
    """
    if role not in ("primary", "additional", "none"):
        raise ValueError("Reference role must be primary, additional, or none")
    with LOCK:
        data = _read(character_id)
        member = next((item for item in data["members"] if item["face_id"] == face_id), None)
        if member is None:
            raise ValueError("That face is not part of this character")
        if role != "none" and member["state"] != "accepted":
            raise ValueError("Accept a face before marking it as a reference")
        data["additional_references"] = [item for item in data["additional_references"] if item != face_id]
        if data["primary_reference"] == face_id:
            data["primary_reference"] = None
        if role == "primary":
            data["primary_reference"] = face_id
        elif role == "additional":
            if len(data["additional_references"]) >= 20:
                raise ValueError("A character takes at most 20 additional references")
            data["additional_references"].append(face_id)
        return _write(_refresh(data))


def recompute(character_id):
    with LOCK:
        return _write(_refresh(_read(character_id)))


# --- the interface future generation work reads --------------------------

def reference_bundle(character_id):
    """Everything an identity-conditioned workflow would need, and nothing else.

    Deliberately read-only and generation-agnostic: it hands over real crop
    references plus the centroid, so an IP-Adapter, img2img, LoRA dataset build
    or scene loop can each take what it needs without this module knowing about
    any of them.
    """
    with LOCK:
        data = _refresh(_read(character_id))
    accepted = [member for member in data["members"] if member["state"] == "accepted"]
    ranked = sorted((member for member in accepted if member["similarity"] is not None),
                    key=lambda member: -member["similarity"])

    def entry(face_id):
        member = next((item for item in data["members"] if item["face_id"] == face_id), None)
        if not member:
            return None
        return {"dataset_id": member["dataset_id"], "face_id": member["face_id"],
                "similarity": member["similarity"],
                "crop_url": f"/faces/datasets/{member['dataset_id']}/faces/{member['face_id']}/crop"}

    centroid = data.get("centroid") or {}
    return {
        "character_id": data["id"], "name": data["name"], "tags": data["tags"],
        "notes": data["notes"], "updated_at": data["updated_at"],
        "representative": entry(data["representative_face_id"]) if data.get("representative_face_id") else None,
        "primary_reference": entry(data["primary_reference"]) if data.get("primary_reference") else None,
        "additional_references": [item for item in (entry(face_id) for face_id in data["additional_references"]) if item],
        "ranked_references": [entry(member["face_id"]) for member in ranked[:64]],
        "reference_count": len(accepted),
        "embedding": {
            "model": "arcface-w600k-r50", "dimensions": store.DIMENSIONS,
            "centroid": centroid.get("vector"), "coherence": centroid.get("coherence"),
            "usable": bool(centroid.get("usable")),
        },
        "caveat": "These faces look alike by embedding similarity. That is not a confirmed identity, "
                  "and a profile does not by itself authorize generating likenesses of a real person.",
    }
