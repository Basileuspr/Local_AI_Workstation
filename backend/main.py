"""
Local AI Workstation — Backend API
FastAPI server that talks to Ollama and streams responses.
This is the PYTHON side of the wall. It handles all AI logic.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import json

# Import route modules
from routes.sessions import router as sessions_router
from routes.files import router as files_router

# --- App Setup ---

app = FastAPI(title="Local AI Workstation")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)
app.include_router(files_router)

OLLAMA_BASE_URL = "http://localhost:11434"


# --- Data Models ---

class ChatMessage(BaseModel):
    role: str
    content: str


class ModelOptions(BaseModel):
    """
    Parameters that control how the model generates text.
    These map directly to Ollama's options API.
    All are optional — if not provided, Ollama uses its defaults.
    """
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    repeat_penalty: float | None = None
    num_predict: int | None = None


class ChatRequest(BaseModel):
    model: str = "mistral"
    messages: list[ChatMessage]
    stream: bool = True
    use_knowledge_base: bool = False
    system_prompt: str | None = None
    options: ModelOptions | None = None


# --- Routes ---

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/models")
async def list_models():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            data = response.json()
            models = [
                {
                    "name": m["name"],
                    "size": m.get("size", 0),
                    "modified": m.get("modified_at", ""),
                }
                for m in data.get("models", [])
            ]
            return {"models": models}
    except httpx.ConnectError:
        return {"models": [], "error": "Ollama is not running"}


@app.post("/chat")
async def chat(request: ChatRequest):
    messages_to_send = [
        {"role": m.role, "content": m.content}
        for m in request.messages
    ]

    # --- Inject system prompt from profile if provided ---
    if request.system_prompt:
        messages_to_send.insert(0, {
            "role": "system",
            "content": request.system_prompt,
        })

    # --- RAG: Inject knowledge base context if enabled ---
    if request.use_knowledge_base and request.messages:
        try:
            from services.knowledge_base import query_knowledge_base

            last_user_msg = None
            for m in reversed(request.messages):
                if m.role == "user":
                    last_user_msg = m.content
                    break

            if last_user_msg:
                results = query_knowledge_base(last_user_msg, n_results=5)

                if results:
                    context_parts = []
                    for r in results:
                        context_parts.append(
                            f"[From: {r['filename']}]\n{r['text']}"
                        )
                    context_text = "\n\n---\n\n".join(context_parts)

                    insert_index = 1 if request.system_prompt else 0
                    rag_message = {
                        "role": "system",
                        "content": (
                            "The following are relevant excerpts from the user's "
                            "knowledge base. Use them to inform your response, but "
                            "only reference them if they're relevant to the question. "
                            "Cite the source filename when using information from these "
                            "excerpts.\n\n"
                            f"{context_text}"
                        ),
                    }
                    messages_to_send.insert(insert_index, rag_message)

        except Exception as e:
            print(f"[Backend] RAG query failed: {e}")

    # --- Build Ollama options from parameters ---
    ollama_options = {}
    if request.options:
        if request.options.temperature is not None:
            ollama_options["temperature"] = request.options.temperature
        if request.options.top_p is not None:
            ollama_options["top_p"] = request.options.top_p
        if request.options.top_k is not None:
            ollama_options["top_k"] = request.options.top_k
        if request.options.repeat_penalty is not None:
            ollama_options["repeat_penalty"] = request.options.repeat_penalty
        if request.options.num_predict is not None:
            ollama_options["num_predict"] = request.options.num_predict

    ollama_payload = {
        "model": request.model,
        "messages": messages_to_send,
        "stream": True,
    }

    if ollama_options:
        ollama_payload["options"] = ollama_options

    # --- Stream the response ---

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json=ollama_payload,
                ) as response:
                    async for line in response.aiter_lines():
                        if line:
                            chunk = json.loads(line)
                            token = chunk.get("message", {}).get("content", "")
                            done = chunk.get("done", False)

                            yield f"data: {json.dumps({'token': token, 'done': done})}\n\n"

                            if done:
                                break

        except httpx.ConnectError:
            yield f"data: {json.dumps({'token': '[Error: Ollama is not running. Start it and try again.]', 'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'token': f'[Error: {str(e)}]', 'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# --- Startup ---

if __name__ == "__main__":
    import uvicorn
    print("\n[OK] Local AI Workstation — Backend starting...")
    print(f"   Ollama expected at: {OLLAMA_BASE_URL}")
    print(f"   API docs available at: http://localhost:8000/docs")
    print()
    uvicorn.run(app, host="0.0.0.0", port=8000)
