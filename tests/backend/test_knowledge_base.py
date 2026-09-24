import asyncio
import hashlib
import json
import threading

import httpx
import pytest

from services import knowledge_base as kb
from services.gpu_coordination import GpuCoordinator
from services.request_queue import QueueCancelled, RequestQueue


@pytest.fixture
def embeddings(tmp_path, monkeypatch):
    monkeypatch.setattr(kb, "KB_DIR", tmp_path / "knowledge")
    calls = []
    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload["input"])
        assert payload["model"] == kb.EMBEDDING_MODEL
        return httpx.Response(200, json={"embeddings": [[float(int(text.split()[-1]) + 1), 1.0]
                                                       for text in payload["input"]]})
    client_type = httpx.Client
    def install(callback):
        monkeypatch.setattr(kb.httpx, "Client", lambda **kwargs:
            client_type(transport=httpx.MockTransport(callback), **kwargs))
    install(handler)
    return calls, install


def test_batched_indexing_preserves_chunk_order_and_replacement(embeddings, monkeypatch):
    calls, _ = embeddings
    chunks = [f"chunk {i}" for i in range(35)]
    monkeypatch.setattr(kb, "_chunk_text", lambda _text: list(chunks))
    result = kb.add_document("test", "notes.txt")
    assert list(map(len, calls)) == [16, 16, 3]
    assert sum(calls, []) == chunks
    collection = kb._get_collection()
    stored = collection.get(include=["documents", "embeddings", "metadatas"])
    for text, vector, metadata in zip(stored["documents"], stored["embeddings"], stored["metadatas"]):
        index = metadata["chunk_index"]
        assert text == chunks[index]
        assert list(vector) == pytest.approx([index + 1, 1], rel=1e-6)
    assert kb.list_documents() == [{"filename": "notes.txt", "doc_id": result["doc_id"], "chunks": 35}]
    chunks[:] = ["revised 0", "revised 1"]
    kb.add_document("revision", "notes.txt")
    assert collection.count() == 2
    assert sorted(collection.get()["documents"]) == chunks


@pytest.mark.parametrize("failure", ["http", "cancel", "missing", "nan", "dimensions"])
def test_failed_or_cancelled_embeddings_preserve_existing_document(embeddings, monkeypatch, failure):
    _, install = embeddings
    doc_id = hashlib.md5(b"notes.txt").hexdigest()[:12]
    old_id = f"{doc_id}_chunk_0"
    collection = kb._get_collection()
    collection.add(ids=[old_id], documents=["original"], embeddings=[[1.0, 1.0]], metadatas=[{"doc_id": doc_id}])
    monkeypatch.setattr(kb, "_chunk_text", lambda _text: [f"chunk {i}" for i in range(17)])
    event = threading.Event()
    calls = []
    def handler(request):
        batch = json.loads(request.content)["input"]
        calls.append(batch)
        if len(calls) == 1:
            if failure == "cancel":
                event.set()
            return httpx.Response(200, json={"embeddings": [[1.0, 1.0] for _ in batch]})
        if failure == "http":
            return httpx.Response(500, json={"error": "failed"})
        vectors = {"missing": [], "nan": [[float("nan"), 1.0]], "dimensions": [[1.0]]}[failure]
        return httpx.Response(200, content=json.dumps({"embeddings": vectors}))
    install(handler)
    with pytest.raises((ValueError, httpx.HTTPStatusError, QueueCancelled)):
        kb.add_document("replacement", "notes.txt", cancel_event=event)
    assert collection.get()["ids"] == [old_id]
    assert collection.get()["documents"] == ["original"]
    if failure == "cancel":
        assert len(calls) == 1


def test_document_listing_only_loads_metadata(monkeypatch):
    class Collection:
        def count(self): return 1
        def get(self, *, include):
            assert include == ["metadatas"]
            return {"metadatas": [{"filename": "notes.txt", "doc_id": "doc", "total_chunks": 1}]}
    monkeypatch.setattr(kb, "_get_collection", Collection)
    assert kb.list_documents()[0]["filename"] == "notes.txt"


@pytest.mark.parametrize("cancel_source", ["queue", "task", "disconnect"])
def test_embedding_admission_and_cancel_retain_gpu_until_worker_exits(monkeypatch, cancel_source):
    from fastapi import HTTPException
    from routes import files
    async def scenario():
        gpu = GpuCoordinator()
        queue = RequestQueue(gpu)
        monkeypatch.setattr(files, "queue", queue)
        prepared = []
        async def prepare(kind): prepared.append(kind)
        monkeypatch.setattr(files, "prepare_runtime", prepare)
        started, cleanup = threading.Event(), threading.Event()
        caller = threading.get_ident()
        def embed(*, cancel_event):
            assert threading.get_ident() != caller
            started.set()
            assert cancel_event.wait(5)
            assert cleanup.wait(5)
            raise QueueCancelled()
        disconnected = False
        class Client:
            async def is_disconnected(self): return disconnected
        image = queue.enqueue("image", "image first")
        assert queue.try_start(image)
        task = asyncio.create_task(files._embedding_work(Client(), "index", embed))
        await asyncio.sleep(0.02)
        assert not started.is_set() and prepared == []
        queue.finish(image)
        async with asyncio.timeout(5):
            while not started.is_set():
                await asyncio.sleep(0.01)
        assert prepared == ["embedding"]
        job = queue.find(kind="embedding")
        next_job = queue.enqueue("image", "next image")
        if cancel_source == "queue":
            await queue.cancel(job)
        elif cancel_source == "task":
            task.cancel()
        else:
            disconnected = True
        async with asyncio.timeout(5):
            while not job.cancel_event.is_set():
                await asyncio.sleep(0.01)
        assert queue.active is job and not queue.try_start(next_job)
        cleanup.set()
        with pytest.raises(HTTPException) as failure:
            await asyncio.wait_for(task, 5)
        assert failure.value.status_code == 499 and job.status == "cancelled"
        assert queue.try_start(next_job)
        queue.finish(next_job)
    asyncio.run(scenario())
