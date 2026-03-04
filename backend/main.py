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
    
    This is the core of the app:
    1. Frontend sends the conversation history
    2. We forward it to Ollama
    3. Ollama generates tokens one at a time
    4. We stream each token back to the frontend as it arrives
    
    Streaming means the user sees words appear in real-time,
    not a long wait followed by a wall of text.
    """

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                # Send the request to Ollama's chat endpoint
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/chat",
                    json={
                        "model": request.model,
                        "messages": [
                            {"role": m.role, "content": m.content}
                            for m in request.messages
                        ],
                        "stream": True,
                    },
                ) as response:
                    # Read each chunk as it arrives from Ollama
                    async for line in response.aiter_lines():
                        if line:
                            chunk = json.loads(line)
                            # Each chunk has a "message" with a "content" field
                            # containing the next token(s)
                            token = chunk.get("message", {}).get("content", "")
                            done = chunk.get("done", False)

                            # Send it to the frontend as a Server-Sent Event
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
    print("\n🟢 Local AI Workstation — Backend starting...")
    print(f"   Ollama expected at: {OLLAMA_BASE_URL}")
    print(f"   API docs available at: http://localhost:8000/docs")
    print()
    uvicorn.run(app, host="0.0.0.0", port=8000)