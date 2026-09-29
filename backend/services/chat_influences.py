"""Bounded, text-only receipts from the actual provider payload; no image bytes."""
from datetime import datetime, timezone
import hashlib
import json

MAX_TEXT = 96000
MAX_MESSAGES = 500


def receipt(payload, *, mode="chat", context=None):
    context = context or {}
    remaining = MAX_TEXT
    records = []
    messages = payload.get("messages", [])
    for index, message in enumerate(messages[:MAX_MESSAGES]):
        content = str(message.get("content") or "")
        role = message.get("role", "unknown")
        label = "Conversation message"
        if role == "system":
            label = "System instructions / context"
            if content.startswith("Rolling session context from earlier in this chat."):
                label = "Rolling chat summary"
            elif content.startswith("The following are durable memories saved for this user."):
                label = "Saved user memories"
            elif content.startswith("The following are relevant excerpts from the user's knowledge base."):
                label = "Knowledge excerpts"
            elif content.startswith("Web source snapshots in this conversation"):
                label = "Web reference handling"
        limit = remaining if role == "system" else min(240, remaining)
        excerpt = content[:limit]
        remaining -= len(excerpt)
        records.append({"position": index + 1, "role": role, "label": label, "text": excerpt,
                        "characters": len(content), "truncated": len(excerpt) < len(content),
                        "sha256": hashlib.sha256(content.encode()).hexdigest(),
                        "images": len(message.get("images") or [])})
    return {"version": 1, "prepared_at": datetime.now(timezone.utc).isoformat(), "mode": mode,
            "model": payload.get("model"), "options": payload.get("options", {}), "think": payload.get("think"),
            "structured_output": bool(payload.get("format")), "messages": records,
            "message_count": len(messages), "omitted_messages": max(0, len(messages) - MAX_MESSAGES),
            "image_count": sum(len(item.get("images") or []) for item in messages),
            **context}


def event(payload, *, mode="chat", context=None):
    return f"data: {json.dumps({'influence_receipt': receipt(payload, mode=mode, context=context)})}\n\n"
