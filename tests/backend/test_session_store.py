"""
Tests for the session store.

Focus is the image-record normalization and decoding, which carry the subtlest
logic in the backend: uploads persist the same picture twice (a preview data
URL plus the raw base64 Ollama needs), and the gallery must show it once.
"""

import base64
import json

import pytest

from services.session_store import (
    _decode_image,
    _ensure_stable_ids,
    _message_image_records,
    create_session,
    delete_session,
    get_session,
    hide_session_image,
    list_session_images,
    list_sessions,
    update_session,
)

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG_BYTES = b"\xff\xd8\xff" + b"\x00" * 16
GIF_BYTES = b"GIF89a" + b"\x00" * 16
WEBP_BYTES = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 8

PNG_B64 = base64.b64encode(PNG_BYTES).decode("ascii")
JPEG_B64 = base64.b64encode(JPEG_BYTES).decode("ascii")


# --- _message_image_records ------------------------------------------------

def test_upload_stored_as_preview_and_raw_base64_yields_one_record():
    """
    The regression this guards: an uploaded image is saved as BOTH a preview
    data URL and the raw base64 payload. Listing both would double every
    picture in the gallery.
    """
    message = {
        "id": "m1",
        "role": "user",
        "content": "[Image uploaded: cat.png (12 KB)]",
        "images": [PNG_B64],
        "imagePreviews": [
            {
                "id": "p1",
                "src": f"data:image/png;base64,{PNG_B64}",
                "name": "cat.png",
                "type": "image/png",
                "size": 12345,
            }
        ],
    }

    records = _message_image_records(message)

    assert len(records) == 1
    assert records[0]["id"] == "p1"
    assert records[0]["name"] == "cat.png"
    assert records[0]["source"] == "uploaded"


def test_raw_image_kept_when_it_does_not_match_the_preview():
    """A raw payload unrelated to the preview is a genuinely separate image."""
    message = {
        "id": "m1",
        "role": "user",
        "images": [JPEG_B64],
        "imagePreviews": [{"id": "p1", "src": f"data:image/png;base64,{PNG_B64}"}],
    }

    records = _message_image_records(message)

    assert len(records) == 2
    assert records[0]["data"].startswith("data:image/png;base64,")
    assert records[1]["data"] == JPEG_B64


def test_identical_src_across_fields_is_deduplicated():
    src = f"data:image/png;base64,{PNG_B64}"
    message = {
        "id": "m1",
        "role": "assistant",
        "imagePreviews": [{"id": "p1", "src": src}],
        "generatedImages": [{"id": "g1", "src": src}],
    }

    assert len(_message_image_records(message)) == 1


def test_generated_images_are_marked_generated_regardless_of_role():
    message = {
        "id": "m1",
        "role": "user",
        "generatedImages": [{"id": "g1", "src": f"data:image/png;base64,{PNG_B64}"}],
    }

    records = _message_image_records(message)

    assert records[0]["source"] == "generated"


def test_assistant_previews_default_to_generated_source():
    message = {
        "id": "m1",
        "role": "assistant",
        "imagePreviews": [{"id": "p1", "src": f"data:image/png;base64,{PNG_B64}"}],
    }

    assert _message_image_records(message)[0]["source"] == "generated"


def test_snake_case_generated_images_field_is_supported():
    message = {
        "id": "m1",
        "role": "assistant",
        "generated_images": [{"id": "g1", "src": f"data:image/png;base64,{PNG_B64}"}],
    }

    records = _message_image_records(message)

    assert len(records) == 1
    assert records[0]["source"] == "generated"


def test_url_and_data_keys_are_accepted_as_sources():
    message = {
        "id": "m1",
        "role": "assistant",
        "generatedImages": [
            {"id": "g1", "url": "/image-generation/outputs/a.png"},
            {"id": "g2", "data": f"data:image/png;base64,{PNG_B64}"},
        ],
    }

    records = _message_image_records(message)

    assert [r["id"] for r in records] == ["g1", "g2"]


def test_preview_without_id_gets_a_positional_fallback_id():
    message = {
        "id": "m1",
        "role": "user",
        "imagePreviews": [{"src": f"data:image/png;base64,{PNG_B64}"}],
    }

    assert _message_image_records(message)[0]["id"] == "imagePreviews-0"


def test_malformed_entries_are_skipped_without_raising():
    message = {
        "id": "m1",
        "role": "user",
        "imagePreviews": ["not-a-dict", {"src": ""}, {"no_src": True}, None],
        "images": ["", None, 42],
    }

    assert _message_image_records(message) == []


def test_non_list_image_fields_are_ignored():
    message = {"id": "m1", "role": "user", "imagePreviews": "nope", "images": "nope"}

    assert _message_image_records(message) == []


def test_message_with_no_images_yields_no_records():
    assert _message_image_records({"id": "m1", "role": "user", "content": "hi"}) == []


# --- _decode_image ---------------------------------------------------------

@pytest.mark.parametrize(
    "raw, expected_type",
    [
        (PNG_BYTES, "image/png"),
        (JPEG_BYTES, "image/jpeg"),
        (GIF_BYTES, "image/gif"),
        (WEBP_BYTES, "image/webp"),
    ],
)
def test_media_type_is_sniffed_from_magic_bytes(raw, expected_type):
    record = {"data": base64.b64encode(raw).decode("ascii"), "type": "image/jpeg"}

    image_bytes, media_type = _decode_image(record)

    assert image_bytes == raw
    assert media_type == expected_type


def test_sniffed_type_overrides_a_wrong_declared_type():
    """A PNG mislabelled as JPEG must still be served as a PNG."""
    record = {"data": PNG_B64, "type": "image/jpeg"}

    _, media_type = _decode_image(record)

    assert media_type == "image/png"


def test_data_url_prefix_is_stripped_before_decoding():
    record = {"data": f"data:image/png;base64,{PNG_B64}"}

    image_bytes, media_type = _decode_image(record)

    assert image_bytes == PNG_BYTES
    assert media_type == "image/png"


def test_unrecognised_bytes_fall_back_to_the_declared_type():
    record = {"data": base64.b64encode(b"just some bytes").decode("ascii"), "type": "image/webp"}

    _, media_type = _decode_image(record)

    assert media_type == "image/webp"


def test_unrecognised_bytes_with_nonsense_declared_type_fall_back_to_jpeg():
    record = {"data": base64.b64encode(b"just some bytes").decode("ascii"), "type": "text/plain"}

    _, media_type = _decode_image(record)

    assert media_type == "image/jpeg"


def test_data_url_without_base64_marker_is_rejected():
    with pytest.raises(ValueError):
        _decode_image({"data": "data:image/png,notbase64"})


def test_invalid_base64_is_rejected():
    with pytest.raises(ValueError):
        _decode_image({"data": "!!!not base64!!!"})


# --- _ensure_stable_ids ----------------------------------------------------

def test_legacy_messages_and_previews_receive_stable_ids():
    session = {"messages": [{"role": "user", "imagePreviews": [{"src": "x"}]}]}

    changed = _ensure_stable_ids(session)

    assert changed is True
    assert session["messages"][0]["id"]
    assert session["messages"][0]["imagePreviews"][0]["id"]
    assert session["hidden_gallery_image_ids"] == []


def test_existing_ids_are_left_alone():
    session = {
        "messages": [{"id": "keep-me", "role": "user"}],
        "hidden_gallery_image_ids": [],
    }

    assert _ensure_stable_ids(session) is False
    assert session["messages"][0]["id"] == "keep-me"


def test_non_list_messages_field_is_repaired():
    session = {"messages": None}

    assert _ensure_stable_ids(session) is True
    assert session["messages"] == []


# --- session lifecycle on disk --------------------------------------------

def test_create_and_get_session_roundtrip(sessions_dir):
    session = create_session(title="My Chat")

    loaded = get_session(session["id"])

    assert loaded["title"] == "My Chat"
    assert loaded["messages"] == []
    assert loaded["memory_summary"] == ""
    assert loaded["summarized_message_count"] == 0


def test_get_missing_session_returns_none(sessions_dir):
    assert get_session("does-not-exist") is None


def test_update_session_persists_memory_fields(sessions_dir):
    """
    Guards the rolling-summary bug: memory state must survive a save/load
    cycle rather than silently resetting.
    """
    session = create_session()
    messages = [{"role": "user", "content": "hello"}]

    update_session(
        session["id"],
        messages,
        model="mistral:latest",
        memory_summary="Goals: ship the thing.",
        summarized_message_count=4,
    )
    loaded = get_session(session["id"])

    assert loaded["memory_summary"] == "Goals: ship the thing."
    assert loaded["summarized_message_count"] == 4
    assert loaded["model"] == "mistral:latest"


def test_update_session_leaves_memory_untouched_when_not_supplied(sessions_dir):
    """Omitting the fields must not clear a summary that already exists."""
    session = create_session()
    update_session(session["id"], [], memory_summary="keep me", summarized_message_count=2)

    update_session(session["id"], [{"role": "user", "content": "hi"}])
    loaded = get_session(session["id"])

    assert loaded["memory_summary"] == "keep me"
    assert loaded["summarized_message_count"] == 2


def test_update_session_autotitles_from_first_user_message(sessions_dir):
    session = create_session()

    update_session(session["id"], [{"role": "user", "content": "Explain quantum tunnelling"}])

    assert get_session(session["id"])["title"] == "Explain quantum tunnelling"


def test_autotitle_truncates_long_messages(sessions_dir):
    session = create_session()
    long_content = "x" * 80

    update_session(session["id"], [{"role": "user", "content": long_content}])

    assert get_session(session["id"])["title"] == "x" * 50 + "..."


def test_explicit_title_wins_over_autotitle(sessions_dir):
    session = create_session()

    update_session(session["id"], [{"role": "user", "content": "ignored"}], title="Chosen")

    assert get_session(session["id"])["title"] == "Chosen"


def test_update_missing_session_returns_none(sessions_dir):
    assert update_session("nope", []) is None


def test_list_sessions_is_sorted_most_recently_updated_first(sessions_dir):
    first = create_session(title="First")
    second = create_session(title="Second")
    update_session(second["id"], [], title="Second")

    listed = list_sessions()

    assert [s["title"] for s in listed][0] == "Second"
    assert {s["id"] for s in listed} == {first["id"], second["id"]}


def test_list_sessions_skips_corrupted_files(sessions_dir):
    create_session(title="Good")
    (sessions_dir / "broken.json").write_text("{not json", encoding="utf-8")

    listed = list_sessions()

    assert [s["title"] for s in listed] == ["Good"]


def test_delete_session_removes_the_file(sessions_dir):
    session = create_session()

    assert delete_session(session["id"]) is True
    assert get_session(session["id"]) is None
    assert delete_session(session["id"]) is False


# --- gallery ---------------------------------------------------------------

def test_gallery_lists_images_across_sessions(sessions_dir):
    session = create_session(title="With pictures")
    update_session(
        session["id"],
        [
            {
                "id": "m1",
                "role": "user",
                "images": [PNG_B64],
                "imagePreviews": [
                    {"id": "p1", "src": f"data:image/png;base64,{PNG_B64}", "name": "cat.png"}
                ],
            }
        ],
    )

    images = list_session_images()

    assert len(images) == 1
    assert images[0]["name"] == "cat.png"
    assert images[0]["session_id"] == session["id"]
    assert images[0]["url"] == f"/sessions/{session['id']}/images/by-id/m1/p1"


def test_hidden_images_are_excluded_from_the_gallery_but_kept_in_chat(sessions_dir):
    session = create_session()
    update_session(
        session["id"],
        [
            {
                "id": "m1",
                "role": "user",
                "imagePreviews": [{"id": "p1", "src": f"data:image/png;base64,{PNG_B64}"}],
            }
        ],
    )

    assert hide_session_image(session["id"], "p1") is True

    assert list_session_images() == []
    assert len(get_session(session["id"])["messages"]) == 1


def test_hiding_an_unknown_image_reports_failure(sessions_dir):
    session = create_session()
    update_session(session["id"], [{"id": "m1", "role": "user", "content": "hi"}])

    assert hide_session_image(session["id"], "not-there") is False


def test_gallery_skips_corrupted_session_files(sessions_dir):
    (sessions_dir / "broken.json").write_text("{not json", encoding="utf-8")

    assert list_session_images() == []
