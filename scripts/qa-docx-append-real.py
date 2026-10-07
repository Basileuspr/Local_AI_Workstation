"""Optional real Ollama create/append smoke; uses disposable chat and artifact stores."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace

root = Path(tempfile.mkdtemp(prefix="law-docx-real-"))
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"), LAW_MODELS_DIR=str(root / "models"), LAW_OLLAMA_URL="http://127.0.0.1:11434", ANONYMIZED_TELEMETRY="False")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import httpx
from docx import Document
from services import chat_documents as docs, session_store

model = sys.argv[1] if len(sys.argv) > 1 else "mistral:latest"
session_id = session_store.create_session("Disposable Word append smoke")["id"]
async def connected(): return False
async def run():
    results = []
    async with httpx.AsyncClient(timeout=600) as client:
        for index, prompt in enumerate([
            "/docx Create a report titled Garden Plan, filename garden_plan.docx. Include one heading Introduction and one short paragraph: The garden contains rosemary and thyme. Do not add other sections.",
            "Add a section titled Watering with one short paragraph: Water the herbs every morning. Return only these two new blocks.",
            "Add a final section titled Harvest with one short paragraph: Harvest the herbs in September. Return only these two new blocks.",
        ], 1):
            start = time.monotonic()
            session_store.append_messages(session_id, [{"id": f"user-{index}", "role": "user", "content": prompt}])
            # Run on CPU so QA does not displace a model the user has loaded on GPU.
            payload = {"model": model, "stream": True, "keep_alive": 0,
                       "options": {"num_gpu": 0, "num_ctx": 4096}, "messages": [{"role": "user", "content": prompt}]}
            events = []
            async for chunk in docs.stream_document(client, payload, SimpleNamespace(session_id=session_id, reply_message_id=f"reply-{index}", model=model), SimpleNamespace(is_disconnected=connected)):
                events.extend(json.loads(line[6:]) for line in chunk.splitlines() if line.startswith("data: "))
            last = events[-1]
            if last.get("error"): raise RuntimeError(last["error"])
            artifact = last["artifacts"][0]
            assert artifact["version"] == index and last["reply_saved"]
            original_path = docs.file_path(artifact["id"], "document.docx")
            (root / f"version-{index}.docx").write_bytes(original_path.read_bytes())
            results.append({"artifact": artifact, "sha256": hashlib.sha256(original_path.read_bytes()).hexdigest(), "seconds": round(time.monotonic()-start, 2)})
            print(json.dumps({"version": index, "seconds": results[-1]["seconds"], "output": str(root)}), flush=True)
        documents = [Document(root / f"version-{index}.docx") for index in (1, 2, 3)]
        texts = [[p.text for p in doc.paragraphs if p.text] for doc in documents]
        assert texts[1][:len(texts[0])] == texts[0] and texts[2][:len(texts[1])] == texts[1]
        for term in ("rosemary", "morning", "September"): assert term.lower() in "\n".join(texts[-1]).lower()
        for result in results:
            assert hashlib.sha256(docs.file_path(result["artifact"]["id"], "document.docx").read_bytes()).hexdigest() == result["sha256"]
        (root / "report.json").write_text(json.dumps({"passed": True, "model": model, "provider": "actual local Ollama on CPU", "results": results, "paragraphs": texts}, indent=2))
        print(json.dumps({"passed": True, "report": str(root / "report.json")}), flush=True)
asyncio.run(run())
