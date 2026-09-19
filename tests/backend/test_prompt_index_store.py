"""
Tests for the prompt index store.

Saved entries and the in-progress editor draft live in separate files on
purpose, so that autosaving a draft can never disturb committed entries.
"""

import json

import pytest

from services.prompt_index_store import (
    clear_draft,
    create_entry,
    delete_entry,
    list_entries,
    load_state,
    save_draft,
    update_entry,
)


# --- entries ---------------------------------------------------------------

def test_create_and_list_entry(prompt_index_paths):
    created = create_entry("Title", "Reusable body", "from a chat", ["writing", "test"])

    entries = list_entries()

    assert len(entries) == 1
    assert entries[0]["id"] == created["id"]
    assert entries[0]["title"] == "Title"
    assert entries[0]["content"] == "Reusable body"
    assert entries[0]["source"] == "from a chat"
    assert entries[0]["tags"] == ["writing", "test"]


def test_entries_require_title_and_content(prompt_index_paths):
    with pytest.raises(ValueError):
        create_entry("", "body")
    with pytest.raises(ValueError):
        create_entry("title", "   ")


def test_tags_are_deduplicated_case_insensitively(prompt_index_paths):
    entry = create_entry("T", "C", None, ["Writing", "writing", "WRITING", "image"])

    assert entry["tags"] == ["Writing", "image"]


def test_update_entry_changes_fields_and_keeps_id(prompt_index_paths):
    created = create_entry("Old", "Old body")

    updated = update_entry(created["id"], "New", "New body", "src", ["tag"])

    assert updated["id"] == created["id"]
    assert updated["title"] == "New"
    assert updated["content"] == "New body"
    assert list_entries()[0]["title"] == "New"


def test_update_unknown_entry_returns_none(prompt_index_paths):
    assert update_entry("nope", "T", "C") is None


def test_delete_entry(prompt_index_paths):
    created = create_entry("T", "C")

    assert delete_entry(created["id"]) is True
    assert list_entries() == []
    assert delete_entry(created["id"]) is False


def test_entries_survive_a_reload_from_disk(prompt_index_paths):
    """Saved entries are the durable half of the index."""
    create_entry("Persisted", "Body")

    reloaded = load_state()

    assert [e["title"] for e in reloaded["entries"]] == ["Persisted"]


def test_corrupted_entries_file_degrades_to_empty_rather_than_crashing(prompt_index_paths):
    entries_path, _ = prompt_index_paths
    entries_path.parent.mkdir(parents=True, exist_ok=True)
    entries_path.write_text("{not json", encoding="utf-8")

    assert list_entries() == []


# --- draft -----------------------------------------------------------------

def test_draft_roundtrips(prompt_index_paths):
    save_draft("new", {"title": "WIP", "content": "half written", "source": "", "tags": "a"}, "query")

    draft = load_state()["draft"]

    assert draft["editor"] == "new"
    assert draft["form"]["title"] == "WIP"
    assert draft["form"]["content"] == "half written"
    assert draft["search"] == "query"


def test_saving_a_draft_does_not_disturb_saved_entries(prompt_index_paths):
    """The regression this guards: draft autosave clobbering the entry list."""
    create_entry("Committed", "Body")

    save_draft("new", {"title": "unsaved", "content": "unsaved"}, "")

    state = load_state()
    assert [e["title"] for e in state["entries"]] == ["Committed"]
    assert state["draft"]["form"]["title"] == "unsaved"


def test_clear_draft_empties_the_draft_but_keeps_entries(prompt_index_paths):
    create_entry("Committed", "Body")
    save_draft("new", {"title": "unsaved", "content": "unsaved"}, "")

    clear_draft()

    state = load_state()
    assert state["draft"] == {}
    assert [e["title"] for e in state["entries"]] == ["Committed"]


def test_missing_draft_file_loads_as_empty(prompt_index_paths):
    assert load_state()["draft"] == {}


def test_corrupted_draft_file_degrades_to_empty(prompt_index_paths):
    _, draft_path = prompt_index_paths
    draft_path.parent.mkdir(parents=True, exist_ok=True)
    draft_path.write_text("{not json", encoding="utf-8")

    assert load_state()["draft"] == {}


def test_draft_with_non_dict_form_is_normalised(prompt_index_paths):
    saved = save_draft("new", "not-a-dict", None)

    assert saved["form"]["title"] == ""
    assert saved["form"]["content"] == ""


def test_entry_writes_are_atomic_leaving_no_temp_file(prompt_index_paths):
    """Entries are written via a .tmp file then replaced; the temp must not linger."""
    entries_path, _ = prompt_index_paths
    create_entry("T", "C")

    assert entries_path.exists()
    assert not entries_path.with_suffix(".tmp").exists()
