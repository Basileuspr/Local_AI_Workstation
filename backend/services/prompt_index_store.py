"""Persistent storage for reusable prompt, glossary, and reference entries."""

import json
import uuid
from datetime import datetime
from pathlib import Path


from config import settings

PROMPT_INDEX_PATH = settings.prompt_index_path
PROMPT_INDEX_DRAFT_PATH = settings.prompt_index_draft_path


def _load_entries() -> list[dict]:
    if not PROMPT_INDEX_PATH.exists():
        return []
    try:
        with open(PROMPT_INDEX_PATH, "r", encoding="utf-8") as file:
            entries = json.load(file)
        return entries if isinstance(entries, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save_entries(entries: list[dict]) -> None:
    PROMPT_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = PROMPT_INDEX_PATH.with_suffix(".tmp")
    with open(temporary_path, "w", encoding="utf-8") as file:
        json.dump(entries, file, ensure_ascii=False, indent=2)
    temporary_path.replace(PROMPT_INDEX_PATH)


def _load_draft() -> dict:
    """Load the in-progress editor separately so saved entries keep their original file."""
    if not PROMPT_INDEX_DRAFT_PATH.exists():
        return {}
    try:
        with open(PROMPT_INDEX_DRAFT_PATH, "r", encoding="utf-8") as file:
            draft = json.load(file)
        return draft if isinstance(draft, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_draft(draft: dict) -> None:
    PROMPT_INDEX_DRAFT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = PROMPT_INDEX_DRAFT_PATH.with_suffix(".tmp")
    with open(temporary_path, "w", encoding="utf-8") as file:
        json.dump(draft, file, ensure_ascii=False, indent=2)
    temporary_path.replace(PROMPT_INDEX_DRAFT_PATH)


def _clean_text(value: str | None, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _clean_tags(tags: list[str] | None) -> list[str]:
    unique_tags = []
    for tag in tags or []:
        clean_tag = _clean_text(tag, 48)
        if clean_tag and clean_tag.casefold() not in {item.casefold() for item in unique_tags}:
            unique_tags.append(clean_tag)
    return unique_tags[:20]


def _entry_payload(title: str, content: str, source: str | None, tags: list[str] | None) -> dict:
    clean_title = _clean_text(title, 120)
    clean_content = _clean_text(content, 50000)
    if not clean_title:
        raise ValueError("An entry title is required")
    if not clean_content:
        raise ValueError("Reusable text is required")
    return {
        "title": clean_title,
        "content": clean_content,
        "source": _clean_text(source, 160),
        "tags": _clean_tags(tags),
    }


def list_entries() -> list[dict]:
    return sorted(_load_entries(), key=lambda entry: entry.get("updated_at", ""), reverse=True)


def load_state() -> dict:
    return {"entries": list_entries(), "draft": _load_draft()}


def save_draft(editor: str | None, form: dict | None, search: str | None = None) -> dict:
    form = form if isinstance(form, dict) else {}
    draft = {
        "editor": _clean_text(editor, 80) or None,
        "form": {
            "title": _clean_text(form.get("title"), 120),
            "content": _clean_text(form.get("content"), 50000),
            "source": _clean_text(form.get("source"), 160),
            "tags": _clean_text(form.get("tags"), 1000),
        },
        "search": _clean_text(search, 200),
        "saved_at": datetime.now().isoformat(timespec="seconds"),
    }
    _save_draft(draft)
    return draft


def clear_draft() -> None:
    _save_draft({})


def create_entry(title: str, content: str, source: str | None = None, tags: list[str] | None = None) -> dict:
    entries = _load_entries()
    now = datetime.now().isoformat(timespec="seconds")
    entry = {
        "id": str(uuid.uuid4())[:8],
        "created_at": now,
        "updated_at": now,
        **_entry_payload(title, content, source, tags),
    }
    entries.append(entry)
    _save_entries(entries)
    return entry


def update_entry(entry_id: str, title: str, content: str, source: str | None = None, tags: list[str] | None = None) -> dict | None:
    entries = _load_entries()
    payload = _entry_payload(title, content, source, tags)
    for entry in entries:
        if entry.get("id") == entry_id:
            entry.update(payload)
            entry["updated_at"] = datetime.now().isoformat(timespec="seconds")
            _save_entries(entries)
            return entry
    return None


def delete_entry(entry_id: str) -> bool:
    entries = _load_entries()
    remaining_entries = [entry for entry in entries if entry.get("id") != entry_id]
    if len(remaining_entries) == len(entries):
        return False
    _save_entries(remaining_entries)
    return True
