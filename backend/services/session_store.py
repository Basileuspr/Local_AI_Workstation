"""
Session Store Service
Manages chat sessions as individual JSON files in data/sessions/.

Key design decisions:
- Each session is a separate file — they never bleed into each other
- Sessions only load when you explicitly choose to resume one
- New sessions start completely clean — no memory from past chats
- File contents read during a session stay in THAT session only
"""

import json
import uuid
from datetime import datetime
from pathlib import Path

# Sessions live in the data/sessions/ folder at the project root
SESSIONS_DIR = Path(__file__).parent.parent.parent / "data" / "sessions"


def ensure_sessions_dir():
    """Create the sessions directory if it doesn't exist."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def create_session(title: str = None) -> dict:
    """
    Create a new, empty session.
    Returns the session object with a unique ID.
    No memory from any previous session is included.
    """
    ensure_sessions_dir()

    session_id = str(uuid.uuid4())[:8]  # Short readable ID like "a3f1b2c9"
    now = datetime.now().isoformat()

    session = {
        "id": session_id,
        "title": title or "New Chat",
        "created_at": now,
        "updated_at": now,
        "model": None,           # Which model was used (set on first message)
        "messages": [],          # Empty — clean slate
    }

    # Save to disk immediately
    _save_session(session)
    return session


def get_session(session_id: str) -> dict | None:
    """
    Load a specific session by ID.
    Returns the full session including all messages, or None if not found.
    """
    ensure_sessions_dir()
    filepath = SESSIONS_DIR / f"{session_id}.json"

    if not filepath.exists():
        return None

    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def update_session(session_id: str, messages: list, model: str = None, title: str = None) -> dict | None:
    """
    Update a session with new messages.
    Called after each exchange (user message + assistant response).
    """
    session = get_session(session_id)
    if not session:
        return None

    session["messages"] = messages
    session["updated_at"] = datetime.now().isoformat()

    if model:
        session["model"] = model

    # Auto-title: use the first user message if title is still default
    if session["title"] == "New Chat" and not title:
        first_user_msg = next((m for m in messages if m["role"] == "user"), None)
        if first_user_msg:
            # Truncate to first 50 chars for a readable title
            content = first_user_msg["content"]
            session["title"] = content[:50] + ("..." if len(content) > 50 else "")

    if title:
        session["title"] = title

    _save_session(session)
    return session


def list_sessions() -> list:
    """
    List all sessions, sorted by most recently updated.
    Returns summary info only — not the full message history.
    This keeps the list fast even with many sessions.
    """
    ensure_sessions_dir()
    sessions = []

    for filepath in SESSIONS_DIR.glob("*.json"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                session = json.load(f)
                sessions.append({
                    "id": session["id"],
                    "title": session["title"],
                    "created_at": session["created_at"],
                    "updated_at": session["updated_at"],
                    "model": session.get("model"),
                    "message_count": len(session.get("messages", [])),
                })
        except (json.JSONDecodeError, KeyError):
            continue  # Skip corrupted files

    # Most recent first
    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return sessions


def delete_session(session_id: str) -> bool:
    """Delete a session permanently."""
    ensure_sessions_dir()
    filepath = SESSIONS_DIR / f"{session_id}.json"

    if filepath.exists():
        filepath.unlink()
        return True
    return False


# --- Internal helpers ---

def _save_session(session: dict):
    """Write session to disk as formatted JSON."""
    ensure_sessions_dir()
    filepath = SESSIONS_DIR / f"{session['id']}.json"

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(session, f, indent=2, ensure_ascii=False)