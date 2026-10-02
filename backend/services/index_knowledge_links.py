"""Explicit references between saved Index entries and existing Knowledge nodes."""
import json

from services import knowledge_base as kb, prompt_index_store as index
from services.knowledge_graph import database


def catalog(entry_id=None, doc_id=None):
    entries = {entry["id"]: entry for entry in index.list_entries()}
    documents = {node["doc_id"]: node for node in kb.list_documents()}
    with database() as connection:
        options = {id: json.loads(value) for id, value in connection.execute("SELECT doc_id, options FROM node_options")}
        pairs = connection.execute("SELECT entry_id, doc_id FROM index_links ORDER BY entry_id, doc_id").fetchall()
    nodes = sorted([
        {"doc_id": id, "filename": node["filename"], "label": options.get(id, {}).get("label") or node["filename"]}
        for id, node in documents.items()
    ], key=lambda node: node["label"].casefold())
    labels = {node["doc_id"]: node["label"] for node in nodes}
    return {"nodes": nodes, "links": [
        {"entry_id": entry, "doc_id": document, "entry_title": entries[entry]["title"], "node_label": labels[document]}
        for entry, document in pairs if entry in entries and document in documents
        and (entry_id is None or entry == entry_id) and (doc_id is None or document == doc_id)
    ]}


def set_link(entry_id, doc_id, *, remove=False):
    # Unlinking also works for stale references; it never removes either source.
    if not remove:
        if not any(entry["id"] == entry_id for entry in index.list_entries()):
            raise LookupError("Index entry no longer exists")
        if not any(node["doc_id"] == doc_id for node in kb.list_documents()):
            raise LookupError("Knowledge node no longer exists")
    with database() as connection:
        if remove:
            connection.execute("DELETE FROM index_links WHERE entry_id = ? AND doc_id = ?", (entry_id, doc_id))
        else:
            connection.execute("INSERT OR IGNORE INTO index_links VALUES (?, ?)", (entry_id, doc_id))


def forget_entry(entry_id):
    # Deleting an unlinked entry should not initialize a Knowledge database.
    if not (kb.KB_DIR / "vault.sqlite3").exists():
        return
    with database() as connection:
        connection.execute("DELETE FROM index_links WHERE entry_id = ?", (entry_id,))
