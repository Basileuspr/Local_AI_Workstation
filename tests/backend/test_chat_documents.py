import asyncio
import base64
import io
import json
import threading
from types import SimpleNamespace
from zipfile import ZipFile

import httpx
import pytest
from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from services import chat_documents as docs, session_store, image_vault, image_store
from routes.artifacts import router


@pytest.fixture
def document_session(sessions_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(docs, "ROOT", tmp_path / "artifacts")
    monkeypatch.setattr(image_vault, "ROOT", tmp_path / "vault")
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    return session_store.create_session()["id"]


@pytest.mark.parametrize("prompt", ["Okay, now make me a .docx", "Make it a Word document", "Can you export this as docx?", "/docx summarize this", "Save this in report.docx"])
def test_creation_intent(prompt):
    assert docs.wants_document(prompt)


@pytest.mark.parametrize("prompt", ["How do I create a docx in Python?", "Don't make a Word document", "Explain docx files", "Write python code for a docx", "hello", "```python\n# make a docx\n```"])
def test_code_and_explanation_requests_stay_normal_chat(prompt):
    assert not docs.wants_document(prompt)


def spec(blocks=None):
    return docs.DocumentSpec(title="Sine Wave Plot", filename="sine_wave.docx", blocks=blocks or [
        {"type": "paragraph", "text": "The plot shows one full sine wave cycle."},
        {"type": "function_plot", "function": "sin", "caption": "Figure 1 Sine wave from 0 to 2 pi"},
        {"type": "table", "headers": ["Parameter", "Value"], "rows": [["Amplitude", "1"]]},
    ])


def test_real_docx_contains_text_table_and_embedded_plot(document_session):
    artifact = docs.create_document(spec(), document_session, {}, threading.Event())
    path = docs.file_path(artifact["id"], "document.docx")
    doc = Document(path)
    assert doc.paragraphs[0].text == "Sine Wave Plot"
    assert not doc.styles["Title"].element.xpath("./w:pPr/w:pBdr")
    assert len(doc.inline_shapes) == 1
    assert doc.tables[0].cell(1, 1).text == "1"
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        assert "word/media/image1.png" in archive.namelist()
    metadata = docs.read_artifact(artifact["id"])
    assert metadata["blocks"][1]["image_file"] == "image-1.png"
    assert artifact["name"] == "sine_wave.docx"


def test_attached_image_is_embedded_and_future_lock_blocks_all_access(document_session, monkeypatch):
    output = io.BytesIO(); Image.new("RGB", (40, 30), "blue").save(output, "PNG")
    session_store.append_messages(document_session, [{"id": "image-message", "role": "user", "content": "Use this plot", "images": [base64.b64encode(output.getvalue()).decode()]}])
    inventory = docs.image_inventory(document_session)
    artifact = docs.create_document(spec([{"type": "image", "image_id": "image-1", "caption": "Attached plot"}]), document_session, inventory, threading.Event())
    metadata = docs.read_artifact(artifact["id"])
    monkeypatch.setattr(image_vault, "locked_hashes", lambda: set(metadata["source_hashes"]))
    for operation in [lambda: docs.read_artifact(artifact["id"]), lambda: docs.file_path(artifact["id"], "document.docx"), lambda: docs.file_path(artifact["id"], "image-0.png")]:
        with pytest.raises(image_vault.LockedImageError): operation()
    assert docs.image_inventory(document_session) == {}


@pytest.mark.parametrize("block", [
    {"type": "image", "image_id": "../../private.png"},
    {"type": "image", "image_id": "https://example.com/secret"},
    {"type": "table", "headers": ["a", "b"], "rows": [["a"]]},
    {"type": "function_plot", "function": "sin", "x_min": 3, "x_max": 1},
])
def test_invalid_assets_and_tables_do_not_publish_partial_files(document_session, block):
    with pytest.raises(ValueError): docs.create_document(spec([block]), document_session, {}, threading.Event())
    assert not list(docs.ROOT.iterdir())


def test_cancellation_leaves_no_completed_document(document_session):
    cancel = threading.Event(); cancel.set()
    with pytest.raises(InterruptedError): docs.create_document(spec(), document_session, {}, cancel)
    assert not list(docs.ROOT.iterdir())


def test_document_source_must_be_a_session_id(document_session):
    with pytest.raises(ValueError): docs.image_inventory("../../outside")
    with pytest.raises(ValueError): docs.create_document(spec(), "../../outside", {}, threading.Event())


def test_duplicate_title_and_windows_reserved_filename(document_session):
    value = spec([{"type": "heading", "text": "Sine Wave Plot"}, {"type": "paragraph", "text": "One cycle."}])
    value.filename = "CON.docx"
    artifact = docs.create_document(value, document_session, {}, threading.Event())
    assert artifact["name"] == "document-CON.docx"
    doc = Document(docs.file_path(artifact["id"], "document.docx"))
    assert [p.text for p in doc.paragraphs] == ["Sine Wave Plot", "One cycle."]


def test_artifact_routes_require_the_app_credential(document_session):
    from services.session_guard import SessionGuard
    artifact = docs.create_document(spec(), document_session, {}, threading.Event())
    app = FastAPI(); app.include_router(router); app.add_middleware(SessionGuard)
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        for suffix in ("", "/download", "/images/image-1.png"):
            assert client.get(f"/artifacts/{artifact['id']}{suffix}").status_code == 403


def test_cancelling_during_build_waits_for_worker_and_does_not_attach(document_session, monkeypatch):
    started, finished = threading.Event(), threading.Event()
    def building(_spec, _session, _inventory, cancel):
        started.set()
        assert cancel.wait(5)
        finished.set()
        raise InterruptedError("Cancelled")
    monkeypatch.setattr(docs, "create_document", building)
    async def connected(): return False
    async def handler(_request):
        return httpx.Response(200, content=json.dumps({"message": {"content": spec().model_dump_json()}, "done": True}))
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            async def consume():
                async for _ in docs.stream_document(client, {"messages": []}, SimpleNamespace(session_id=document_session, reply_message_id="cancelled", model="test"), SimpleNamespace(is_disconnected=connected)): pass
            task = asyncio.create_task(consume())
            assert await asyncio.to_thread(started.wait, 5)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
    asyncio.run(run())
    assert finished.is_set()
    assert session_store.get_session(document_session)["messages"] == []


def test_preview_download_traversal_and_deleted_chat(document_session):
    artifact = docs.create_document(spec(), document_session, {}, threading.Event())
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        assert client.get(f"/artifacts/{artifact['id']}").json()["title"] == "Sine Wave Plot"
        response = client.get(f"/artifacts/{artifact['id']}/download")
        assert response.status_code == 200 and response.content.startswith(b"PK")
        assert "sine_wave.docx" in response.headers["content-disposition"]
        assert client.get(f"/artifacts/{artifact['id']}/images/document.json").status_code == 404
        assert client.get("/artifacts/invalid").status_code == 404
        session_store.delete_session(document_session)
        assert client.get(f"/artifacts/{artifact['id']}/download").status_code == 404


def stream_result(session_id, output=None, end=True, error=None, reason="stop", prompt="Make me a docx", reply_id="reply-1", operation=None, messages=None):
    captured = []
    async def handler(request):
        captured.append(json.loads(request.content))
        chunks = [{"message": {"content": output if output is not None else spec().model_dump_json()}, "done": end, "done_reason": reason}]
        if error: chunks = [{"error": error}]
        return httpx.Response(200, content="\n".join(json.dumps(chunk) for chunk in chunks))
    async def connected(): return False
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            request = SimpleNamespace(session_id=session_id, reply_message_id=reply_id, model="test-model")
            payload = {"model": "test-model", "messages": messages or [{"role": "system", "content": "Source fact: amplitude is 1"}, {"role": "user", "content": prompt}]}
            return [event async for event in docs.stream_document(client, payload, request, SimpleNamespace(is_disconnected=connected), operation=operation)]
    events = [json.loads(line[6:]) for chunk in asyncio.run(run()) for line in chunk.splitlines() if line.startswith("data: ")]
    return events, captured


def test_stream_persists_artifact_before_completion_and_retains_context(document_session):
    events, captured = stream_result(document_session)
    result = events[-1]
    assert result["done"] and result["artifacts"][0]["kind"] == "docx"
    assert "Source fact" in captured[0]["messages"][0]["content"]
    assert captured[0]["format"]["type"] == "object"
    message = session_store.get_session(document_session)["messages"][0]
    assert message["id"] == "reply-1" and message["artifacts"] == result["artifacts"]
    assert "Amplitude | 1" in message["document_text"]
    trace = next(event["influence_receipt"] for event in events if "influence_receipt" in event)
    assert trace == message["influence_receipt"]
    assert trace["mode"] == "document" and trace["structured_output"]
    assert trace["options"] == captured[0]["options"]
    assert trace["options"]["temperature"] == 0
    assert trace["messages"][0]["text"] == captured[0]["messages"][0]["content"]


@pytest.mark.parametrize("kwargs", [{"output": "```python\nprint('fake file')\n```"}, {"end": False}, {"error": "CUDA failure"}, {"reason": "length"}])
def test_bad_or_incomplete_model_output_returns_visible_error_without_fake_attachment(document_session, kwargs):
    events, _ = stream_result(document_session, **kwargs)
    assert events[-1]["error"] and events[-1]["done"]
    assert not events[-1].get("artifacts")
    assert session_store.get_session(document_session)["messages"] == []


def addition(text="A new section."):
    return docs.DocumentAdditionSpec(blocks=[{"type": "heading", "text": "Next section"}, {"type": "paragraph", "text": text}])


@pytest.mark.parametrize("prompt", ["Add a conclusion to the .docx", "Append a section to the Word document", "Continue", "Write the next section", "Draft another section", "Expand the report with examples", "/docx append More details", "Add a summary to sine_wave.docx", "Write chapter two", "Draft part 2", "Update the document by adding a conclusion"])
def test_followups_target_the_saved_document(document_session, prompt):
    events, _ = stream_result(document_session)
    operation = docs.document_operation(prompt, document_session)
    assert operation["action"] == "append"
    assert operation["base"]["id"] == events[-1]["artifacts"][0]["id"]


@pytest.mark.parametrize("prompt", ["Create a new Word document", "Make me another .docx", "/docx Start a separate report"])
def test_explicit_creation_still_creates_an_independent_document(document_session, prompt):
    stream_result(document_session)
    assert docs.document_operation(prompt, document_session) == {"action": "create"}


@pytest.mark.parametrize("prompt", ["How do I add content to a docx?", "Don't add anything to the Word document", "Explain how to extend a report", "Write python code to append a docx", "Thanks"])
def test_followup_routing_does_not_capture_explanations(document_session, prompt):
    stream_result(document_session)
    assert docs.document_operation(prompt, document_session) is None


def test_repeated_additions_preserve_original_package_content_and_downloads(document_session):
    import hashlib
    events, _ = stream_result(document_session)
    first = events[-1]["artifacts"][0]
    original = docs.file_path(first["id"], "document.docx").read_bytes()
    doc = Document(io.BytesIO(original))
    old_body = [element.xml for element in doc.element.body if not element.tag.endswith("sectPr")]
    previous = first
    for version in (2, 3):
        events, captured = stream_result(document_session, addition(f"Part {version}").model_dump_json(),
            prompt=f"Add part {version}", reply_id=f"reply-{version}")
        assert events[-1].get("reply_saved"), events[-1]
        current = events[-1]["artifacts"][0]
        assert (current["version"], current["parent_id"], current["document_id"]) == (version, previous["id"], first["id"])
        assert current["name"] == first["name"]
        new_doc = Document(docs.file_path(current["id"], "document.docx"))
        assert [element.xml for element in new_doc.element.body if not element.tag.endswith("sectPr")][:len(old_body)] == old_body
        assert len(new_doc.tables) == len(doc.tables) == 1
        assert len(new_doc.inline_shapes) == len(doc.inline_shapes) == 1
        assert [p.text for p in new_doc.paragraphs].count("Sine Wave Plot") == 1
        assert "Part 2" in events[-1]["document_text"]
        assert "ONLY the NEW blocks" in captured[0]["messages"][0]["content"]
        assert "Amplitude | 1" in captured[0]["messages"][0]["content"]
        assert captured[0]["format"]["required"] == ["blocks"]
        previous = current
    assert hashlib.sha256(docs.file_path(first["id"], "document.docx").read_bytes()).digest() == hashlib.sha256(original).digest()
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        assert client.get(f"/artifacts/{previous['id']}").json()["version"] == 3
        assert client.get(f"/artifacts/{first['id']}/download").content == original
        assert "Part 3" in "\n".join(p.text for p in Document(io.BytesIO(client.get(f"/artifacts/{previous['id']}/download").content)).paragraphs)


def test_selected_old_version_follows_its_family_not_a_different_document(document_session):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    second = stream_result(document_session, addition().model_dump_json(), prompt="Add next section", reply_id="reply-2")[0][-1]["artifacts"][0]
    other_spec = spec(); other_spec.filename = "other.docx"
    other = stream_result(document_session, other_spec.model_dump_json(), prompt="Create another docx", reply_id="other")[0][-1]["artifacts"][0]
    assert docs.latest_document(document_session)["id"] == other["id"]
    assert docs.latest_document(document_session, first["id"])["id"] == second["id"]
    assert docs.document_operation("Add to sine_wave.docx", document_session)["base"]["id"] == second["id"]
    assert docs.document_operation("/docx append details", document_session, artifact_id=first["id"])["base"]["id"] == second["id"]


def test_missing_ambiguous_and_foreign_targets_fail_instead_of_overwriting(document_session):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    stream_result(document_session, prompt="Create another docx", reply_id="other")
    with pytest.raises(ValueError, match="More than one"): docs.document_operation("Add to sine_wave.docx", document_session)
    with pytest.raises(ValueError, match="not attached"): docs.document_operation("Add to missing.docx", document_session)
    another_chat = session_store.create_session()["id"]
    with pytest.raises(ValueError): docs.latest_document(another_chat, first["id"])
    with pytest.raises(ValueError): docs.document_operation("/docx append", None)
    with pytest.raises(ValueError): docs.latest_document(document_session, "../outside")


def test_missing_latest_version_does_not_silently_fall_back(document_session):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    second = stream_result(document_session, addition().model_dump_json(), prompt="Add next section", reply_id="reply-2")[0][-1]["artifacts"][0]
    docs.file_path(second["id"], "document.docx").unlink()
    events, _ = stream_result(document_session, addition().model_dump_json(), prompt="Add again", reply_id="reply-3")
    assert events[-1]["error"] and "missing" in events[-1]["error"]
    assert docs.latest_document(document_session, first["id"])["id"] == second["id"]
    assert len(session_store.get_session(document_session)["messages"]) == 2


def test_retry_of_saved_reply_does_not_duplicate_addition_or_call_model(document_session):
    stream_result(document_session)
    kwargs = {"output": addition("Once only").model_dump_json(), "prompt": "Append one section", "reply_id": "reply-2"}
    first, _ = stream_result(document_session, **kwargs)
    replay, captured = stream_result(document_session, **kwargs)
    assert captured == []
    assert replay[-1]["artifacts"] == first[-1]["artifacts"]
    assert replay[-1]["reply_saved"]
    assert len(session_store.get_session(document_session)["messages"]) == 2
    changed, _ = stream_result(document_session, **{**kwargs, "prompt": "Append different content"})
    assert "already used" in changed[-1]["error"]


def test_two_additions_drafted_against_same_version_are_serialized_without_loss(document_session):
    from concurrent.futures import ThreadPoolExecutor
    stream_result(document_session)
    base = docs.latest_document(document_session)
    def build(index):
        return docs._build_and_save(addition(f"Concurrent part {index}"), document_session, {}, threading.Event(), base, f"reply-{index}", "test", {}, f"key-{index}")
    with ThreadPoolExecutor(max_workers=2) as executor:
        replies = list(executor.map(build, (2, 3)))
    assert sorted(reply["artifacts"][0]["version"] for reply in replies) == [2, 3]
    current = docs.latest_document(document_session)
    assert all(f"Concurrent part {index}" in docs.document_text(current) for index in (2, 3))


def test_images_and_formatting_survive_append_without_preview_name_collisions(document_session):
    first = stream_result(document_session, spec([{"type": "heading", "text": "Sine Wave Plot"}, {"type": "function_plot", "function": "sin"}]).model_dump_json())[0][-1]["artifacts"][0]
    path = docs.file_path(first["id"], "document.docx")
    doc = Document(path); doc.paragraphs[0].runs[0].italic = True; doc.sections[0].left_margin = 1234567; doc.save(path)
    before = path.read_bytes()
    value = docs.DocumentAdditionSpec(blocks=[{"type": "function_plot", "function": "cos", "caption": "New plot"}])
    current = stream_result(document_session, value.model_dump_json(), prompt="Add a cosine plot", reply_id="reply-2")[0][-1]["artifacts"][0]
    doc = Document(docs.file_path(current["id"], "document.docx"))
    assert doc.paragraphs[0].runs[0].italic and abs(doc.sections[0].left_margin - 1234567) < 635
    assert len(doc.inline_shapes) == 2
    metadata = docs.read_artifact(current["id"])
    assert [block["image_file"] for block in metadata["blocks"]] == ["image-1.png", "image-2.png"]
    assert docs.file_path(current["id"], "image-1.png").read_bytes() == docs.file_path(first["id"], "image-1.png").read_bytes()
    assert docs.file_path(current["id"], "image-2.png").read_bytes() != docs.file_path(first["id"], "image-1.png").read_bytes()
    assert path.read_bytes() == before
    assert set(docs.read_artifact(first["id"])["source_hashes"]) <= set(metadata["source_hashes"])


@pytest.mark.parametrize("kwargs", [{"output": "{}"}, {"end": False}, {"error": "Provider disconnected"}, {"reason": "length"}])
def test_failed_append_preserves_latest_saved_document(document_session, kwargs):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    before = docs.file_path(first["id"], "document.docx").read_bytes()
    events, _ = stream_result(document_session, prompt="Add a conclusion", reply_id="reply-2", **kwargs)
    assert events[-1]["error"] and not events[-1].get("artifacts")
    assert docs.latest_document(document_session)["id"] == first["id"]
    assert docs.file_path(first["id"], "document.docx").read_bytes() == before


def test_append_retains_privacy_lock_and_cancel_guards(document_session, monkeypatch):
    stream_result(document_session)
    base = docs.latest_document(document_session)
    cancelled = threading.Event(); cancelled.set()
    with pytest.raises(InterruptedError): docs._build_and_save(addition(), document_session, {}, cancelled, base, "cancelled", "test", {}, "cancel")
    assert len(session_store.get_session(document_session)["messages"]) == 1
    stream_result(document_session, addition().model_dump_json(), prompt="Add a section", reply_id="reply-2")
    monkeypatch.setattr(image_vault, "locked_hashes", lambda: set(base["source_hashes"]))
    with pytest.raises(image_vault.LockedImageError): docs.latest_document(document_session)


def test_append_bounds_cumulative_document_size(document_session, monkeypatch):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    monkeypatch.setattr(docs, "MAX_DOCUMENT_BLOCKS", 3)
    events, _ = stream_result(document_session, addition().model_dump_json(), prompt="Add a section", reply_id="reply-2")
    assert "section limit" in events[-1]["error"]
    assert docs.latest_document(document_session)["id"] == first["id"]


def test_repeated_title_alone_is_not_reported_as_a_successful_addition(document_session):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    value = docs.DocumentAdditionSpec(blocks=[{"type": "heading", "text": "Sine Wave Plot"}])
    events, _ = stream_result(document_session, value.model_dump_json(), prompt="Add a section", reply_id="reply-2")
    assert "no new document content" in events[-1]["error"]
    assert docs.latest_document(document_session)["id"] == first["id"]


def test_long_document_append_uses_bounded_reference_and_keeps_full_file(document_session):
    from services.context_awareness import payload_usage
    long = spec([{"type": "paragraph", "text": "Earlier detail. " * 400} for _ in range(10)])
    stream_result(document_session, long.model_dump_json())
    prompt = "Add a conclusion to the document"
    messages = [{"role":"assistant", "content":"Created file\n[Document content]\n" + "Duplicate earlier detail. " * 10000}, {"role":"user", "content":prompt}]
    events, captured = stream_result(document_session, addition("Final conclusion").model_dump_json(), prompt=prompt, reply_id="reply-2", messages=messages)
    assert not events[-1].get("error"), events[-1]
    assert len(json.dumps(captured[0]["messages"])) < 18000
    assert captured[0]["messages"][1]["content"] == "Created file"
    usage = payload_usage(captured[0])
    assert usage["estimated_prompt_tokens"] + usage["output_reserve"] + 512 <= captured[0]["options"]["num_ctx"]
    assert docs.document_text(docs.latest_document(document_session)).count("Earlier detail.") == 4000
    assert "Final conclusion" in events[-1]["document_text"]


def test_empty_append_command_does_not_invent_an_addition(document_session):
    first = stream_result(document_session)[0][-1]["artifacts"][0]
    events, captured = stream_result(document_session, prompt="/docx append", reply_id="reply-2")
    assert "Describe the new content" in events[-1]["error"]
    assert captured == [] and docs.latest_document(document_session)["id"] == first["id"]
    with pytest.raises(ValueError, match="Describe the new content"):
        docs.document_operation("/docx append", document_session, artifact_id=first["id"])
