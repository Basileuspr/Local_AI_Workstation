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

from fastapi import APIRouter, UploadFile, File, HTTPException, Query

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from services.file_parser import parse_file
from services.knowledge_base import (
    add_document,
    query_knowledge_base,
    list_documents,
    remove_document,
)

router = APIRouter(prefix="/files", tags=["files"])


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
    result = parse_file(contents, file.filename)

    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


# =============================================
# KNOWLEDGE BASE — RAG pipeline
# =============================================

@router.post("/knowledge-base/add")
async def add_to_knowledge_base(file: UploadFile = File(...)):
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
    parsed = parse_file(contents, file.filename)

    if parsed["error"]:
        raise HTTPException(status_code=400, detail=parsed["error"])

    if not parsed["text"].strip():
        raise HTTPException(status_code=400, detail="No text content found in file")

    result = add_document(parsed["text"], file.filename)

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return {
        "message": f"Added {file.filename} to knowledge base",
        "filename": result["filename"],
        "doc_id": result["doc_id"],
        "chunks": result["chunks"],
    }


@router.get("/knowledge-base/query")
async def search_knowledge_base(
    q: str = Query(..., description="Search query"),
    n: int = Query(5, description="Number of results to return"),
):
    """
    Search the knowledge base for chunks relevant to a query.
    
    Returns the most relevant text chunks along with their source documents.
    The frontend can inject these into the LLM context before sending a message.
    """
    results = query_knowledge_base(q, n_results=n)
    return {"query": q, "results": results, "count": len(results)}


@router.get("/knowledge-base/list")
async def list_knowledge_base():
    """List all documents currently in the knowledge base."""
    docs = list_documents()
    return {"documents": docs, "count": len(docs)}


@router.delete("/knowledge-base/{doc_id}")
async def remove_from_knowledge_base(doc_id: str):
    """Remove a document and all its chunks from the knowledge base."""
    removed = remove_document(doc_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}
