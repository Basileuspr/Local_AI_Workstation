"""
Export Routes
API endpoints for exporting conversations as files.

The backend formats the conversation data.
The frontend triggers the download.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from services.session_store import get_session

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/{session_id}/txt")
async def export_as_txt(session_id: str):
    """Export a conversation as plain text."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    lines = []
    lines.append(f"Conversation: {session['title']}")
    lines.append(f"Date: {session['created_at']}")
    if session.get("model"):
        lines.append(f"Model: {session['model']}")
    lines.append("=" * 50)
    lines.append("")

    for msg in session.get("messages", []):
        role = msg["role"].upper()
        content = msg["content"]

        # Skip raw file upload content — show summary instead
        if msg["role"] == "user" and content.startswith("[File uploaded:"):
            first_line = content.split("\n")[0]
            lines.append(f"{role}: {first_line}")
        else:
            lines.append(f"{role}: {content}")
        lines.append("")

    text = "\n".join(lines)
    filename = _safe_filename(session["title"]) + ".txt"

    return Response(
        content=text,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/md")
async def export_as_markdown(session_id: str):
    """Export a conversation as markdown."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    lines = []
    lines.append(f"# {session['title']}")
    lines.append("")
    lines.append(f"**Date:** {session['created_at']}")
    if session.get("model"):
        lines.append(f"**Model:** {session['model']}")
    lines.append("")
    lines.append("---")
    lines.append("")

    for msg in session.get("messages", []):
        if msg["role"] == "user":
            content = msg["content"]
            if content.startswith("[File uploaded:"):
                first_line = content.split("\n")[0]
                lines.append(f"**You:** {first_line}")
            else:
                lines.append(f"**You:** {content}")
        elif msg["role"] == "assistant":
            lines.append(f"**Assistant:** {msg['content']}")
        elif msg["role"] == "system":
            lines.append(f"*System: {msg['content']}*")
        lines.append("")

    text = "\n".join(lines)
    filename = _safe_filename(session["title"]) + ".md"

    return Response(
        content=text,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/json")
async def export_as_json(session_id: str):
    """Export a conversation as raw JSON."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    import json
    text = json.dumps(session, indent=2, ensure_ascii=False)
    filename = _safe_filename(session["title"]) + ".json"

    return Response(
        content=text,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _safe_filename(title: str) -> str:
    """Convert a session title to a safe filename."""
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_") else "" for c in title)
    safe = safe.strip()[:60]
    return safe or "conversation"