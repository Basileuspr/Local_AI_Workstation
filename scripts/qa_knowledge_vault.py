"""Disposable Knowledge graph fixture. Does not open the user's data directory."""
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

root = Path(tempfile.mkdtemp(prefix="law-knowledge-vault-qa-"))
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"), LAW_MODELS_DIR=str(root / "models"), ANONYMIZED_TELEMETRY="False")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.files import router
from services import knowledge_base as kb
import uvicorn

documents = [
    ("a", "Project Atlas.md", "Project Atlas connects [[Research notes]] with [[Architecture]] and [[Release plan]].\nThis is synthetic QA content, not a personal document."),
    ("b", "Research notes.md", "Research connects [[User interviews]] to [[Project Atlas]].\nTopics: offline retrieval, local documents and source attribution."),
    ("c", "Architecture.md", "[[Project Atlas]] uses local storage. See [[Storage design]] and [[Retrieval pipeline]]."),
    ("d", "Release plan.md", "Build the [[Architecture]] and validate [[Research notes]]."),
    ("e", "User interviews.md", "Users want searchable local documents and clear connections."),
    ("f", "Storage design.md", "SQLite stores explicit relationships. [[Architecture]] describes the system."),
    ("g", "Retrieval pipeline.md", "Indexed chunks are retrieved for chat. [[Research notes]] records the questions."),
    ("h", "Reading list.txt", "A standalone document is still available to RAG."),
]
kb._get_collection().add(ids=[f"{id}_0" for id, _, _ in documents], documents=[text for _, _, text in documents],
    embeddings=[[1., 0., 0.] for _ in documents],
    metadatas=[{"doc_id": id, "filename": name, "chunk_index": 0, "total_chunks": 1} for id, name, _ in documents])
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["app://local"], allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
sock = socket.socket(); sock.bind(("127.0.0.1", 0))
server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True); thread.start()
while not server.started: time.sleep(.02)
print(json.dumps({"url": f"http://127.0.0.1:{sock.getsockname()[1]}", "directory": str(root)}), flush=True)
sys.stdin.readline()
server.should_exit = True
thread.join(timeout=10)
