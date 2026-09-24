"""
File Routes
API endpoints for file reading and knowledge base management.

Two distinct features, one set of routes:

1. POST /files/parse — Direct upload: extracts text, returns it for chat context
   (Use when you want to ask about a specific document)

2. POST /files/knowledge-base/add — RAG: adds document to searchable knowledge base
   GET  /files/knowledge-base/query — Searches knowledge base for relevant chunks
   GET  /files/knowledge-base/list — Lists all documents in knowledge base
   DELETE /files/knowledge-base/{doc_id} — Removes a document

The file_parser service is shared by both paths.
"""

import asyncio
from contextlib import suppress

from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from services.file_parser import parse_file
from services.request_queue import queue, QueueCancelled, prepare_runtime
from services.knowledge_base import (
    add_document,
    query_knowledge_base,
    list_documents,
    remove_document,
)

router = APIRouter(prefix="/files", tags=["files"])


class KnowledgeLink(BaseModel):
    source: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=100)


class KnowledgePosition(BaseModel):
    x: float = Field(ge=-100000, le=100000, allow_inf_nan=False)
    y: float = Field(ge=-100000, le=100000, allow_inf_nan=False)


@router.get("/knowledge-base/graph")
def knowledge_graph():
    from services.knowledge_graph import graph
    return graph()


@router.post("/knowledge-base/graph/links")
def add_knowledge_link(link: KnowledgeLink):
    return _change_knowledge_link(link)


@router.delete("/knowledge-base/graph/links")
def delete_knowledge_link(link: KnowledgeLink):
    return _change_knowledge_link(link, remove=True)


def _change_knowledge_link(link, remove=False):
    from services.knowledge_graph import set_link
    try:
        set_link(link.source, link.target, remove=remove)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"ok": True}


@router.put("/knowledge-base/graph/positions/{doc_id}")
def save_knowledge_position(doc_id: str, position: KnowledgePosition):
    from services.knowledge_graph import set_position
    try:
        set_position(doc_id, position.x, position.y)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"ok": True}


@router.get("/knowledge-base/documents/{doc_id}")
def read_knowledge_document(doc_id: str, offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)):
    from services.knowledge_graph import document
    try:
        return document(doc_id, offset, limit)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


async def _embedding_work(client_request, label, operation, *args):
    """Serialize Ollama embeddings with inference; retain the lease until exit."""
    job = queue.enqueue("embedding", label)
    worker = monitor = None
    finished = asyncio.Event()
    error = None

    async def watch_disconnect():
        while not finished.is_set():
            if await client_request.is_disconnected() and not finished.is_set():
                await queue.cancel(job)
                return
            try:
                await asyncio.wait_for(finished.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass

    try:
        await queue.wait(job, client_request)
        monitor = asyncio.create_task(watch_disconnect())
        await prepare_runtime("embedding")
        if job.cancel_event.is_set():
            raise QueueCancelled()
        worker = asyncio.create_task(run_in_threadpool(operation, *args, cancel_event=job.cancel_event))
        result = await asyncio.shield(worker)
        if job.cancel_event.is_set():
            raise QueueCancelled()
        return result
    except (QueueCancelled, asyncio.CancelledError):
        job.cancel_event.set()
        if worker:
            with suppress(Exception):
                await asyncio.shield(worker)
        raise HTTPException(499, "Knowledge-base request cancelled")
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        finished.set()
        try:
            if monitor:
                with suppress(asyncio.CancelledError):
                    await monitor
        finally:
            queue.finish(job, error)


# =============================================
# DIRECT FILE UPLOAD — Full text into chat
# =============================================

@router.post("/parse")
async def parse_uploaded_file(file: UploadFile = File(...)):
    """
    Read a file and return its full text.
    
    The frontend uses this when you drag a file into chat.
    The extracted text gets injected into the conversation context
    so the LLM can answer questions about it.
    
    This does NOT add the file to the knowledge base.
    It's a one-time read for the current conversation.
    """
    contents = await file.read()
    # PDF and DOCX extraction is CPU-bound and can take seconds on a large
    # document; off the event loop so other requests keep being served.
    result = await run_in_threadpool(parse_file, contents, file.filename)

    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


# =============================================
# KNOWLEDGE BASE — RAG pipeline
# =============================================

@router.post("/knowledge-base/add")
async def add_to_knowledge_base(client_request: Request, file: UploadFile = File(...)):
    """
    Add a document to the knowledge base for RAG.
    
    The file gets:
    1. Parsed (text extracted)
    2. Chunked (split into smaller pieces)
    3. Embedded (converted to vectors via nomic-embed-text)
    4. Stored in ChromaDB
    
    After this, the document is searchable via the query endpoint.
    """
    contents = await file.read()
    parsed = await run_in_threadpool(parse_file, contents, file.filename)

    if parsed["error"]:
        raise HTTPException(status_code=400, detail=parsed["error"])

    if not parsed["text"].strip():
        raise HTTPException(status_code=400, detail="No text content found in file")

    result = await _embedding_work(client_request, f"Index document: {file.filename}",
                                   add_document, parsed["text"], file.filename)

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return {
        "message": f"Added {file.filename} to knowledge base",
        "filename": result["filename"],
        "doc_id": result["doc_id"],
        "chunks": result["chunks"],
        "page_count": parsed.get("page_count"),
        "ocr_pages": parsed.get("ocr_pages", []),
        "ocr_model": parsed.get("ocr_model"),
    }


@router.get("/knowledge-base/query")
async def search_knowledge_base(
    client_request: Request,
    q: str = Query(..., description="Search query"),
    n: int = Query(5, description="Number of results to return"),
):
    """
    Search the knowledge base for chunks relevant to a query.
    
    Returns the most relevant text chunks along with their source documents.
    The frontend can inject these into the LLM context before sending a message.
    """
    results = await _embedding_work(client_request, "Search knowledge base", query_knowledge_base, q, n)
    return {"query": q, "results": results, "count": len(results)}


@router.get("/knowledge-base/list")
def list_knowledge_base():
    """List all documents currently in the knowledge base."""
    docs = list_documents()
    return {"documents": docs, "count": len(docs)}


@router.delete("/knowledge-base/{doc_id}")
def remove_from_knowledge_base(doc_id: str):
    """Remove a document and all its chunks from the knowledge base."""
    removed = remove_document(doc_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}
