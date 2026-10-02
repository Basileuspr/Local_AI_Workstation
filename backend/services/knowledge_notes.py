"""Documents authored directly in Knowledge, indexed through the existing RAG pipeline."""
import re
import json
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator
from services import knowledge_base as kb
from services import knowledge_graph as vault
from services.knowledge_node_options import KnowledgeNodeOptions


class KnowledgeNodeDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=100)
    kind: Literal["note", "idea", "project", "place", "event", "reference"] = "note"
    text: str = Field(default="", max_length=100000)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Give the node a title on one line")
        return value


STYLES = {
    "note": {"color": "#6d9cbc", "shape": "circle", "icon": "document"},
    "idea": {"color": "#edc66b", "shape": "diamond", "icon": "idea"},
    "project": {"color": "#77c6ab", "shape": "hexagon", "icon": "flag"},
    "place": {"color": "#b89bea", "shape": "square", "icon": "flag"},
    "event": {"color": "#ed9393", "shape": "diamond", "icon": "star"},
    "reference": {"color": "#77c6ab", "shape": "square", "icon": "book"},
}


def read_node(doc_id):
    vault._require_documents(doc_id)
    with vault.database() as connection:
        row = connection.execute("SELECT filename, title, kind, text FROM authored_nodes WHERE doc_id = ?", (doc_id,)).fetchone()
    if row is None:
        raise LookupError("This document was not started inside Knowledge")
    return dict(zip(("filename", "title", "kind", "text"), row), doc_id=doc_id)


def save_node(draft: KnowledgeNodeDraft, doc_id=None, *, cancel_event=None):
    existing = read_node(doc_id) if doc_id else None
    # A distinct filename prevents same-title nodes from replacing any existing document.
    title = re.sub(r'[<>:"/\\|?*\[\]#\x00-\x1f]', "_", draft.title).strip(" .")[:48] or "Node"
    filename = existing["filename"] if existing else f"Knowledge-{title}-{uuid4().hex}.md"
    text = f"# {draft.title}\n\nType: {draft.kind}\n\n{draft.text.strip()}\n"
    result = kb.add_document(text, filename, cancel_event=cancel_event)
    if result.get("error"):
        raise ValueError(result["error"])
    with vault.database() as connection:
        connection.execute("INSERT INTO authored_nodes (doc_id, filename, title, kind, text) VALUES (?, ?, ?, ?, ?) "
                           "ON CONFLICT(doc_id) DO UPDATE SET title=excluded.title, kind=excluded.kind, text=excluded.text",
                           (result["doc_id"], filename, draft.title, draft.kind, draft.text))
        if not existing:
            options = KnowledgeNodeOptions(label=draft.title, tags=[draft.kind], **STYLES[draft.kind])
            connection.execute("INSERT INTO node_options (doc_id, options) VALUES (?, ?)", (result["doc_id"], options.model_dump_json()))
        else:
            saved = connection.execute("SELECT options FROM node_options WHERE doc_id = ?", (result["doc_id"],)).fetchone()
            if saved:
                options = json.loads(saved[0])
                if options.get("label") == existing["title"]:
                    options["label"] = draft.title
                if existing["kind"] != draft.kind:
                    for key, value in STYLES[existing["kind"]].items():
                        if key != "icon" and options.get(key) == value:
                            options[key] = STYLES[draft.kind][key]
                options["tags"] = list(dict.fromkeys(draft.kind if tag == existing["kind"] else tag for tag in options.get("tags", [])))
                connection.execute("UPDATE node_options SET options = ? WHERE doc_id = ?", (json.dumps(options), result["doc_id"]))
    return {**result, "title": draft.title, "kind": draft.kind}
