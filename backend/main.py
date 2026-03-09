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

# CORS: allows the React frontend (JavaScript side) to talk to this server.
# Without this, the browser blocks requests between different ports.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, lock this to your frontend's URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(sessions_router)
app.include_router(files_router)

# Ollama runs on this address by default
OLLAMA_BASE_URL = "http://localhost:11434"


# --- Data Models ---
# These define what shape the data is when it arrives from the frontend.

class ChatMessage(BaseModel):
    role: str       # "user" or "assistant"
    content: str    # The actual message text


class ChatRequest(BaseModel):
    model: str = "mistral"          # Which model to use (default: mistral)
    messages: list[ChatMessage]     # Conversation history
    stream: bool = True             # Stream tokens as they generate
    use_knowledge_base: bool = False  # Whether to search KB for context


# --- Routes ---

@app.get("/health")
async def health_check():
    """
    Simple check: is the server running?
    The frontend calls this to show a green/red status indicator.
    """
    return {"status": "ok"}


@app.get("/models")
async def list_models():
    """
    Ask Ollama what models are available locally.
    Returns the list so the frontend can show a model selector dropdown.
    """
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
    """
    Send a message to the LLM and stream the response back.
    
    If use_knowledge_base is True, searches the knowledge base for
    relevant context and injects it into the conversation before
    sending to the LLM. This is the RAG part.
    """

    messages_to_send = [
        {"role": m.role, "content": m.content}
        for m in request.messages
    ]

    # --- RAG: Inject knowledge base context if enabled ---
    if request.use_knowledge_base and request.messages:
        try:
            from services.knowledge_base import query_knowledge_base

            # Use the latest user message as the search query
            last_user_msg = None
            for m in reversed(request.messages):
                if m.role == "user":
                    last_user_msg = m.content
                    break

            if last_user_msg:
                results = query_knowledge_base(last_user_msg, n_results=5)

                if results:
                    # Build context from relevant chunks
                    context_parts = []
                    for r in results:
                        context_parts.append(
                            f"[From: {r['filename']}]\n{r['text']}"
                        )
                    context_text = "\n\n---\n\n".join(context_parts)

                    # Inject as a system message at the start
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
                    messages_to_send.insert(0, rag_message)

        except Exception as e:
            # If RAG fails, continue without it — don't break the chat
            print(f"[Backend] RAG query failed: {e}")

    # --- Stream the response ---

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={
                        "model": request.model,
                        "messages": messages_to_send,
                        "stream": True,
                    },
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
