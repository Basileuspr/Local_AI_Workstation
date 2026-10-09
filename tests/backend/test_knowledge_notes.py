import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes import files
from services import knowledge_base as kb, knowledge_graph as vault, knowledge_notes as notes
from services.knowledge_node_options import KnowledgeNodeOptions


@pytest.fixture
def note_index(tmp_path, monkeypatch):
    monkeypatch.setattr(kb, "KB_DIR", tmp_path / "knowledge")
    monkeypatch.setattr(kb, "_create_embeddings", lambda texts, cancel_event=None: [[1., 0., 0.] for _ in texts])
    return kb._get_collection()


def test_create_blank_typed_nodes_duplicate_titles_and_edit_source(note_index):
    first = notes.save_node(notes.KnowledgeNodeDraft(title="  My idea  ", kind="idea"))
    second = notes.save_node(notes.KnowledgeNodeDraft(title="My idea", kind="project", text="Plan details"))
    assert first["doc_id"] != second["doc_id"]
    assert notes.read_node(first["doc_id"])["text"] == ""
    node = next(node for node in vault.graph()["nodes"] if node["doc_id"] == first["doc_id"])
    assert node["authored"] and node["node_kind"] == "idea"
    assert node["options"]["shape"] == "diamond"
    assert "# My idea" in vault.document(first["doc_id"])["chunks"][0]["text"]
    vault.set_position(first["doc_id"], 1, 2, 3)
    vault.set_link(first["doc_id"], second["doc_id"])
    edited = notes.save_node(notes.KnowledgeNodeDraft(title="Revised idea", kind="note", text="New text"), first["doc_id"])
    assert edited["doc_id"] == first["doc_id"] and edited["filename"] == first["filename"]
    assert notes.read_node(first["doc_id"])["text"] == "New text"
    node = next(node for node in vault.graph()["nodes"] if node["doc_id"] == first["doc_id"])
    assert node["options"]["label"] == "Revised idea" and node["options"]["tags"] == ["note"]
    assert node["options"]["icon"] == "idea"
    assert node["position"] == {"x": 1, "y": 2, "z": 3}
    assert vault.graph()["edges"][0]["kinds"] == ["manual"]
    vault.set_options(first["doc_id"], KnowledgeNodeOptions(label="Custom display", color="#ff0000", tags=["favorite"]))
    notes.save_node(notes.KnowledgeNodeDraft(title="Another title", text="More text"), first["doc_id"])
    node = next(node for node in vault.graph()["nodes"] if node["doc_id"] == first["doc_id"])
    assert node["options"]["label"] == "Custom display" and node["options"]["color"] == "#ff0000"
    assert node["options"]["tags"] == ["favorite"]
    vault.set_symbol(first["doc_id"], "star")
    notes.save_node(notes.KnowledgeNodeDraft(title="Another title", kind="project"), first["doc_id"])
    node = next(node for node in vault.graph()["nodes"] if node["doc_id"] == first["doc_id"])
    assert node["options"]["icon"] == "star"


def test_titles_resolve_wikilinks_and_duplicates_are_ambiguous(note_index):
    target = notes.save_node(notes.KnowledgeNodeDraft(title="Example topic"))
    source = notes.save_node(notes.KnowledgeNodeDraft(title="Source", text="See [[EXAMPLE TOPIC]]"))
    graph = vault.graph()
    assert graph["edges"][0]["kinds"] == ["wikilink"]
    notes.save_node(notes.KnowledgeNodeDraft(title="Example topic"))
    graph = vault.graph()
    assert not graph["edges"]
    assert next(node for node in graph["nodes"] if node["doc_id"] == source["doc_id"])["unresolved_links"] == ["EXAMPLE TOPIC"]
    assert kb.remove_document(target["doc_id"])
    with vault.database() as connection:
        assert not connection.execute("SELECT * FROM authored_nodes WHERE doc_id = ?", (target["doc_id"],)).fetchall()


def test_embedding_failure_keeps_old_source_and_index(note_index, monkeypatch):
    node = notes.save_node(notes.KnowledgeNodeDraft(title="Original", text="Keep this content"))
    old = vault.document(node["doc_id"])
    def fail(*args, **kwargs): raise ValueError("Embedding unavailable")
    monkeypatch.setattr(kb, "_create_embeddings", fail)
    with pytest.raises(ValueError, match="Embedding unavailable"):
        notes.save_node(notes.KnowledgeNodeDraft(title="Revised", text="Replacement"), node["doc_id"])
    assert notes.read_node(node["doc_id"])["text"] == "Keep this content"
    assert vault.document(node["doc_id"]) == old
    with pytest.raises(ValueError): notes.save_node(notes.KnowledgeNodeDraft(title="Failed creation"))
    assert len(vault.graph()["nodes"]) == 1


def test_routes_create_read_update_and_validate(note_index, monkeypatch):
    async def embedding_work(request, label, operation, *args):
        return operation(*args, cancel_event=None)
    monkeypatch.setattr(files, "_embedding_work", embedding_work)
    app = FastAPI(); app.include_router(files.router)
    with TestClient(app) as client:
        for payload in [{"title": " "}, {"title": "Bad\nTitle"}, {"title": "x", "kind": "unknown"}, {"title": "x", "text": "x" * 100001}]:
            assert client.post("/files/knowledge-base/nodes", json=payload).status_code == 422
        created = client.post("/files/knowledge-base/nodes", json={"title": "A note", "text": "Hello"})
        assert created.status_code == 200
        node = created.json(); path = f'/files/knowledge-base/nodes/{node["doc_id"]}'
        assert client.get(path).json()["text"] == "Hello"
        assert client.put(path, json={"title": "A note", "text": "Updated"}).status_code == 200
        assert client.get(path).json()["text"] == "Updated"
        assert client.get("/files/knowledge-base/nodes/missing").status_code == 404
        assert client.put("/files/knowledge-base/nodes/missing", json={"title": "No"}).status_code == 404
        imported = kb.add_document("Imported source", "imported.md")
        assert client.get(f'/files/knowledge-base/nodes/{imported["doc_id"]}').status_code == 404


def test_existing_node_can_become_character_and_other_kinds_without_losing_identity(note_index, monkeypatch):
    from services.faces import bank
    profile_id = "a" * 32
    monkeypatch.setattr(bank, "get_character", lambda id: {"id": id, "name": "Mara"} if id == profile_id else (_ for _ in ()).throw(ValueError("Missing character")))
    created = notes.save_node(notes.KnowledgeNodeDraft(title="Untitled node"))
    other = notes.save_node(notes.KnowledgeNodeDraft(title="Reference"))
    vault.set_position(created["doc_id"], 12, 24, 36)
    vault.set_link(created["doc_id"], other["doc_id"])
    vault.set_options(created["doc_id"], KnowledgeNodeOptions(label="Untitled node", color="#ff0000", icon="check", tags=["note", "favorite"], locked=True))
    character = notes.save_node(notes.KnowledgeNodeDraft(title="Mara", kind="character", text="My own biography", character_id=profile_id), created["doc_id"])
    assert character["doc_id"] == created["doc_id"] and character["filename"] == created["filename"]
    assert notes.read_node(created["doc_id"])["character_id"] == profile_id
    node = next(node for node in vault.graph()["nodes"] if node["doc_id"] == created["doc_id"])
    assert node["node_kind"] == "character" and node["character_id"] == profile_id
    assert node["node_title"] == "Mara" and node["options"]["tags"] == ["character", "favorite"]
    assert node["options"]["color"] == "#ff0000" and node["options"]["icon"] == "check" and node["options"]["locked"]
    assert node["position"] == {"x": 12, "y": 24, "z": 36} and len(vault.graph()["edges"]) == 1
    assert f"Character profile ID: {profile_id}" in vault.document(created["doc_id"])["chunks"][0]["text"]
    for kind in ("project", "idea", "event", "place", "reference", "note", "character"):
        changed = notes.save_node(notes.KnowledgeNodeDraft(title="Mara", kind=kind, text="My own biography"), created["doc_id"])
        assert changed["doc_id"] == created["doc_id"]
        assert notes.read_node(created["doc_id"])["character_id"] == ""
        assert notes.read_node(created["doc_id"])["text"] == "My own biography"
    assert len(vault.graph()["nodes"]) == 2
    before = notes.read_node(created["doc_id"])
    with pytest.raises(ValueError, match="Missing character"):
        notes.save_node(notes.KnowledgeNodeDraft(title="Missing", kind="character", character_id="b" * 32), created["doc_id"])
    assert notes.read_node(created["doc_id"]) == before
    for draft in ({"title": "x", "kind": "note", "character_id": profile_id}, {"title": "x", "kind": "character", "character_id": "../profile"}):
        with pytest.raises(ValueError): notes.KnowledgeNodeDraft(**draft)


def test_old_authored_node_schema_migrates_without_changing_content(note_index):
    import sqlite3
    with sqlite3.connect(kb.KB_DIR / "vault.sqlite3") as connection:
        connection.execute("CREATE TABLE authored_nodes (doc_id TEXT PRIMARY KEY, filename TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL)")
        connection.execute("INSERT INTO authored_nodes VALUES ('old', 'Old.md', 'Old', 'note', 'Keep these notes')")
    with vault.database() as connection:
        assert connection.execute("SELECT title, text, character_id FROM authored_nodes WHERE doc_id = 'old'").fetchone() == ("Old", "Keep these notes", "")
    with vault.database() as connection:
        assert connection.execute("SELECT COUNT(*) FROM authored_nodes").fetchone()[0] == 1
