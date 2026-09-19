"""
Knowledge Base Service
Handles the RAG pipeline: chunk → embed → store → retrieve.

Uses:
- langchain-text-splitters for chunking documents
- Ollama + nomic-embed-text for creating embeddings locally
- ChromaDB as the local vector database

Everything runs locally. No internet required.
"""

import hashlib
import httpx
from pathlib import Path
from langchain_text_splitters import RecursiveCharacterTextSplitter
import chromadb

from config import settings
from services.app_logging import get_logger

logger = get_logger("backend.knowledge_base")

# All of these previously duplicated values that also lived in main.py. They
# now share one definition, so pointing the app at a different Ollama host or
# embedding model is a single change.
KB_DIR = settings.knowledge_base_dir
OLLAMA_BASE_URL = settings.ollama_base_url
EMBEDDING_MODEL = settings.embedding_model
CHUNK_SIZE = settings.chunk_size
CHUNK_OVERLAP = settings.chunk_overlap


def _get_collection():
    """Get or create the ChromaDB collection."""
    KB_DIR.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(KB_DIR))
    return client.get_or_create_collection(
        name="knowledge_base",
        metadata={"hnsw:space": "cosine"},  # Use cosine similarity
    )


def _create_embedding(text: str) -> list[float]:
    """
    Create an embedding vector for a piece of text using Ollama.
    Uses nomic-embed-text which is already installed.
    """
    response = httpx.post(
        f"{OLLAMA_BASE_URL}/api/embed",
        json={"model": EMBEDDING_MODEL, "input": text},
        timeout=30.0,
    )
    response.raise_for_status()
    data = response.json()
    # Ollama returns embeddings in data["embeddings"] as a list of lists
    return data["embeddings"][0]


def _chunk_text(text: str) -> list[str]:
    """
    Split text into overlapping chunks.
    Overlap ensures that context isn't lost at chunk boundaries.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return splitter.split_text(text)


def add_document(text: str, filename: str) -> dict:
    """
    Add a document to the knowledge base.
    
    1. Chunks the text into smaller pieces
    2. Creates an embedding for each chunk
    3. Stores chunks + embeddings in ChromaDB
    
    Returns summary info about what was stored.
    """
    collection = _get_collection()

    # Create a document ID from the filename
    doc_id = hashlib.md5(filename.encode()).hexdigest()[:12]

    # Remove existing chunks for this document (in case of re-upload)
    try:
        existing = collection.get(where={"doc_id": doc_id})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
            logger.info("Replaced %d existing chunks for %s", len(existing["ids"]), filename)
    except Exception:
        # Best effort: a failed cleanup leaves stale chunks but must not block
        # the re-upload. Logged because duplicate chunks skew later retrieval.
        logger.warning("Could not clear existing chunks for %s", filename, exc_info=True)

    # Chunk the text
    chunks = _chunk_text(text)

    if not chunks:
        return {
            "filename": filename,
            "chunks": 0,
            "error": "No text to chunk",
        }

    # Create embeddings and store
    ids = []
    embeddings = []
    documents = []
    metadatas = []

    for i, chunk in enumerate(chunks):
        chunk_id = f"{doc_id}_chunk_{i}"
        embedding = _create_embedding(chunk)

        ids.append(chunk_id)
        embeddings.append(embedding)
        documents.append(chunk)
        metadatas.append({
            "doc_id": doc_id,
            "filename": filename,
            "chunk_index": i,
            "total_chunks": len(chunks),
        })

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )

    return {
        "filename": filename,
        "doc_id": doc_id,
        "chunks": len(chunks),
        "error": None,
    }


def query_knowledge_base(query: str, n_results: int = 5) -> list[dict]:
    """
    Search the knowledge base for chunks relevant to the query.
    
    1. Creates an embedding of the query
    2. Finds the most similar chunks in ChromaDB
    3. Returns the chunks with their source info
    
    This is what gets called before sending a message to the LLM —
    relevant chunks are injected into the conversation context.
    """
    collection = _get_collection()

    # Check if collection has any documents
    if collection.count() == 0:
        return []

    # Embed the query
    query_embedding = _create_embedding(query)

    # Search for similar chunks
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, collection.count()),
    )

    # Format results
    chunks = []
    for i in range(len(results["ids"][0])):
        chunks.append({
            "text": results["documents"][0][i],
            "filename": results["metadatas"][0][i]["filename"],
            "chunk_index": results["metadatas"][0][i]["chunk_index"],
            "distance": results["distances"][0][i] if results["distances"] else None,
        })

    return chunks


def count_documents() -> int:
    """
    Chunk count, used by the status probe.

    Deliberately cheap: it must not pull every document's metadata just to
    tell the interface whether the index is readable.
    """
    return _get_collection().count()


def list_documents() -> list[dict]:
    """
    List all documents in the knowledge base.
    Returns unique documents with their chunk counts.
    """
    collection = _get_collection()

    if collection.count() == 0:
        return []

    # Get all metadata
    all_data = collection.get()

    # Group by document
    docs = {}
    for meta in all_data["metadatas"]:
        filename = meta["filename"]
        if filename not in docs:
            docs[filename] = {
                "filename": filename,
                "doc_id": meta["doc_id"],
                "chunks": meta["total_chunks"],
            }

    return list(docs.values())


def remove_document(doc_id: str) -> bool:
    """Remove a document and all its chunks from the knowledge base."""
    collection = _get_collection()

    try:
        existing = collection.get(where={"doc_id": doc_id})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
            logger.info("Removed %d chunks for doc_id %s", len(existing["ids"]), doc_id)
            return True
        logger.info("No chunks found for doc_id %s", doc_id)
    except Exception:
        logger.exception("Failed to remove doc_id %s from the knowledge base", doc_id)

    return False
