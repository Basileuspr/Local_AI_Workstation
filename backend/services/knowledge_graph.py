"""Document graph over the existing RAG index; never edits Chroma's database."""
from contextlib import contextmanager
from pathlib import PurePosixPath
import re
import sqlite3

from services import knowledge_base as kb


@contextmanager
def database():
    kb.KB_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(kb.KB_DIR / "vault.sqlite3", timeout=15)
    try:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS links (
                source TEXT NOT NULL, target TEXT NOT NULL,
                PRIMARY KEY (source, target), CHECK (source < target));
            CREATE TABLE IF NOT EXISTS positions (
                doc_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL);
        """)
        with connection:
            yield connection
    finally:
        connection.close()


def _names(filename):
    name = filename.replace("\\", "/").casefold().strip()
    path = PurePosixPath(name)
    return {name, str(path.with_suffix("")), path.name, path.stem}


def graph():
    nodes = sorted(kb.list_documents(), key=lambda item: item["filename"].casefold())
    ids = {node["doc_id"] for node in nodes}
    aliases = {}
    for node in nodes:
        for alias in _names(node["filename"]):
            aliases.setdefault(alias, set()).add(node["doc_id"])
    links = {}
    unresolved = {doc_id: set() for doc_id in ids}
    collection = kb._get_collection()
    # Bounded reads avoid loading embeddings or all indexed text at once.
    offset = 0
    while ids:
        batch = collection.get(include=["metadatas", "documents"], limit=256, offset=offset)
        if not batch["ids"]:
            break
        for meta, text in zip(batch["metadatas"], batch["documents"]):
            source = meta.get("doc_id")
            if source not in ids:
                continue
            for reference in re.findall(r"\[\[([^\[\]\n]{1,300})\]\]", text or ""):
                name = reference.split("|", 1)[0].split("#", 1)[0].strip()
                if not name:
                    continue
                matches = aliases.get(name.replace("\\", "/").casefold(), set())
                if len(matches) != 1:
                    unresolved[source].add(name)
                    continue
                target = next(iter(matches))
                if source != target:
                    pair = tuple(sorted((source, target)))
                    links.setdefault(pair, set()).add("wikilink")
        offset += len(batch["ids"])
    with database() as connection:
        for source, target in connection.execute("SELECT source, target FROM links"):
            if source in ids and target in ids:
                links.setdefault((source, target), set()).add("manual")
        positions = {doc_id: {"x": x, "y": y} for doc_id, x, y in connection.execute("SELECT doc_id, x, y FROM positions")}
    return {
        "nodes": [{**node, "position": positions.get(node["doc_id"]), "unresolved_links": sorted(unresolved[node["doc_id"]])} for node in nodes],
        "edges": [{"source": source, "target": target, "kinds": sorted(kinds)} for (source, target), kinds in sorted(links.items())],
    }


def _require_documents(*ids):
    existing = {node["doc_id"] for node in kb.list_documents()}
    if not all(doc_id in existing for doc_id in ids):
        raise LookupError("Document no longer exists in Knowledge")


def set_link(source, target, *, remove=False):
    _require_documents(source, target)
    if source == target:
        raise ValueError("Choose a different document to connect")
    pair = tuple(sorted((source, target)))
    with database() as connection:
        if remove:
            connection.execute("DELETE FROM links WHERE source = ? AND target = ?", pair)
        else:
            connection.execute("INSERT OR IGNORE INTO links VALUES (?, ?)", pair)


def set_position(doc_id, x, y):
    _require_documents(doc_id)
    with database() as connection:
        connection.execute("INSERT INTO positions VALUES (?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET x=excluded.x, y=excluded.y", (doc_id, x, y))


def forget_document(doc_id):
    with database() as connection:
        connection.execute("DELETE FROM links WHERE source = ? OR target = ?", (doc_id, doc_id))
        connection.execute("DELETE FROM positions WHERE doc_id = ?", (doc_id,))


def document(doc_id, offset=0, limit=30):
    _require_documents(doc_id)
    # Chunk indices are stable source order, unlike Chroma's internal ordering.
    metadata = kb._get_collection().get(where={"doc_id": doc_id}, include=["metadatas"])
    ordered = sorted(zip(metadata["ids"], metadata["metadatas"]), key=lambda item: item[1]["chunk_index"])
    selected = ordered[offset:offset + limit]
    chunks = []
    if selected:
        data = kb._get_collection().get(ids=[item[0] for item in selected], include=["documents", "metadatas"])
        chunks = sorted([{"index": meta["chunk_index"], "text": text} for meta, text in zip(data["metadatas"], data["documents"])], key=lambda item: item["index"])
    return {"doc_id": doc_id, "chunks": chunks, "total": len(ordered), "offset": offset}
