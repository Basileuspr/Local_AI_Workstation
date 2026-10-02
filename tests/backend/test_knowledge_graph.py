import pytest
import sqlite3
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import knowledge_base as kb
from services import knowledge_graph as vault
from routes.files import router


@pytest.fixture
def documents(tmp_path, monkeypatch):
    monkeypatch.setattr(kb, "KB_DIR", tmp_path / "knowledge")
    collection = kb._get_collection()
    collection.add(
        ids=["a_2", "a_0", "a_1", "b_0", "c_0"],
        documents=["Last chunk", "[[Budget|costs]] [[missing]] [[Plan]]", "[[Budget#Forecast]]", "Budget text", "Isolated document"],
        metadatas=[
            {"doc_id": "a", "filename": "Plan.md", "chunk_index": i, "total_chunks": 3} for i in [2, 0, 1]
        ] + [{"doc_id": "b", "filename": "Budget.md", "chunk_index": 0, "total_chunks": 1},
             {"doc_id": "c", "filename": "Other.txt", "chunk_index": 0, "total_chunks": 1}],
        embeddings=[[1., 0.]] * 5,
    )
    return collection


def test_wikilinks_deduplicate_chunks_and_report_missing(documents):
    graph = vault.graph()
    assert len(graph["nodes"]) == 3
    assert graph["edges"] == [{"source": "a", "target": "b", "kinds": ["wikilink"]}]
    assert next(node for node in graph["nodes"] if node["doc_id"] == "a")["unresolved_links"] == ["missing"]


def test_manual_links_are_undirected_and_independent_of_wikilinks(documents):
    vault.set_link("b", "a")
    vault.set_link("a", "b")
    assert vault.graph()["edges"] == [{"source": "a", "target": "b", "kinds": ["manual", "wikilink"]}]
    vault.set_link("b", "a", remove=True)
    assert vault.graph()["edges"][0]["kinds"] == ["wikilink"]
    with pytest.raises(ValueError): vault.set_link("a", "a")
    with pytest.raises(LookupError): vault.set_link("a", "missing")


def test_positions_and_links_persist_and_document_deletion_cleans_them(documents):
    vault.set_position("c", 122.5, -17)
    vault.set_link("a", "c")
    assert next(node for node in vault.graph()["nodes"] if node["doc_id"] == "c")["position"] == {"x": 122.5, "y": -17}
    assert kb.remove_document("c")
    with vault.database() as connection:
        assert connection.execute("SELECT * FROM positions").fetchall() == []
        assert connection.execute("SELECT * FROM links").fetchall() == []
    assert len(vault.graph()["nodes"]) == 2


def test_ambiguous_names_do_not_create_false_links(documents):
    documents.add(ids=["d_0"], documents=["Another budget"], embeddings=[[1., 0.]],
                  metadatas=[{"doc_id": "d", "filename": "other/Budget.md", "chunk_index": 0, "total_chunks": 1}])
    assert vault.graph()["edges"] == []
    assert "Budget" in next(node for node in vault.graph()["nodes"] if node["doc_id"] == "a")["unresolved_links"]


def test_reader_orders_chunks_and_paginates(documents):
    assert vault.document("a", 1, 1) == {"doc_id": "a", "chunks": [{"index": 1, "text": "[[Budget#Forecast]]"}], "total": 3, "offset": 1}
    assert vault.document("a", 20)["chunks"] == []
    with pytest.raises(LookupError): vault.document("missing")


def test_routes_validate_positions_and_reject_missing_documents(documents):
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        assert client.get("/files/knowledge-base/graph").status_code == 200
        assert client.post("/files/knowledge-base/graph/links", json={"source": "a", "target": "c"}).status_code == 200
        assert client.put("/files/knowledge-base/graph/positions/a", json={"x": 5, "y": 6}).status_code == 200
        assert client.put("/files/knowledge-base/graph/positions/a", json={"x": 100001, "y": 6}).status_code == 422
        assert client.post("/files/knowledge-base/graph/links", json={"source": "a", "target": "missing"}).status_code == 404
        assert client.get("/files/knowledge-base/documents/a?limit=1&offset=2").json()["chunks"] == [{"index": 2, "text": "Last chunk"}]
        assert client.get("/files/knowledge-base/documents/a?offset=-1").status_code == 422
        assert client.delete("/files/knowledge-base/a").status_code == 200
        assert client.get("/files/knowledge-base/documents/a").status_code == 404


def test_empty_vault(tmp_path, monkeypatch):
    monkeypatch.setattr(kb, "KB_DIR", tmp_path / "empty")
    assert vault.graph() == {"nodes": [], "edges": []}


def test_node_options_persist_validate_lock_and_clean_up(documents):
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        path = "/files/knowledge-base/graph/options/c"
        options = {"label": "My reference", "color": "#ffcc00", "shape": "hexagon", "size": 40,
                   "size_mode": "fixed", "icon": "star", "border": "dashed", "label_mode": "full",
                   "font_size": 18, "tags": [" research ", "research", ""], "note": "A private graph note", "locked": True}
        saved = client.put(path, json=options)
        assert saved.status_code == 200
        assert saved.json()["options"]["tags"] == ["research"]
        stored = next(node for node in client.get("/files/knowledge-base/graph").json()["nodes"] if node["doc_id"] == "c")
        assert stored["options"] == saved.json()["options"]
        assert vault.document("c")["chunks"][0]["text"] == "Isolated document"
        assert client.put("/files/knowledge-base/graph/positions/c", json={"x": 1, "y": 2}).status_code == 409
        for invalid in [{"color": "url(javascript:alert(1))"}, {"shape": "script"}, {"size": 100},
                        {"icon": "<img>"}, {"tags": ["x" * 31]}, {"tags": [str(i) for i in range(13)]},
                        {"note": "x" * 2001}, {"label": "x" * 101}, {"extra": "unknown"}]:
            assert client.put(path, json=invalid).status_code == 422
        assert client.put("/files/knowledge-base/graph/options/missing", json={}).status_code == 404
        assert client.put(path, json={}).status_code == 200
        assert client.put("/files/knowledge-base/graph/positions/c", json={"x": 1, "y": 2}).status_code == 200
        assert kb.remove_document("c")
        with vault.database() as connection:
            assert connection.execute("SELECT * FROM node_options").fetchall() == []


def test_3d_positions_preserve_depth_for_legacy_requests_and_validate_routes(documents):
    vault.set_position("a", 10, 20, -37.5)
    assert next(node for node in vault.graph()["nodes"] if node["doc_id"] == "a")["position"] == {"x": 10, "y": 20, "z": -37.5}
    # Existing integrations that only send x/y must not flatten a saved 3D node.
    vault.set_position("a", 15, 25)
    assert next(node for node in vault.graph()["nodes"] if node["doc_id"] == "a")["position"]["z"] == -37.5
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        path = "/files/knowledge-base/graph/positions/a"
        assert client.put(path, json={"x": 1, "y": 2, "z": 300}).status_code == 200
        for value in [100001, -100001, "NaN", "Infinity"]:
            assert client.put(path, json={"x": 1, "y": 2, "z": value}).status_code == 422
        assert client.put("/files/knowledge-base/graph/options/a", json={"locked": True}).status_code == 200
        assert client.put(path, json={"x": 1, "y": 2, "z": 400}).status_code == 409
        assert kb.remove_document("a")
        with vault.database() as connection:
            assert connection.execute("SELECT * FROM positions WHERE doc_id='a'").fetchall() == []


def test_legacy_position_table_migrates_without_changing_xy_or_other_metadata(documents):
    path = kb.KB_DIR / "vault.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE positions (doc_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL)")
        connection.execute("INSERT INTO positions VALUES ('a', 123.5, -98)")
    assert next(node for node in vault.graph()["nodes"] if node["doc_id"] == "a")["position"] == {"x": 123.5, "y": -98}
    vault.set_position("a", 123.5, -98, 45)
    assert next(node for node in vault.graph()["nodes"] if node["doc_id"] == "a")["position"] == {"x": 123.5, "y": -98, "z": 45}


def test_symbol_saves_independently_preserving_skin_organization_and_positions(documents):
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        assert next(node for node in vault.graph()["nodes"] if node["doc_id"] == "c")["options"]["icon"] == "document"
        vault.set_position("c", 11, 22, 33)
        vault.set_link("c", "a")
        original = client.put("/files/knowledge-base/graph/options/c", json={
            "shape": "hexagon", "color": "#ffcc00", "label": "My reference",
            "tags": ["favorite"], "note": "Preserve me", "locked": True,
        }).json()["options"]
        path = "/files/knowledge-base/graph/symbols/c"
        saved = client.put(path, json={"icon": "star"})
        assert saved.status_code == 200
        assert saved.json()["options"] == {**original, "icon": "star"}
        graph = client.get("/files/knowledge-base/graph").json()
        node = next(node for node in graph["nodes"] if node["doc_id"] == "c")
        assert node["options"] == saved.json()["options"]
        assert node["position"] == {"x": 11, "y": 22, "z": 33}
        assert any(edge["target"] == "c" and "manual" in edge["kinds"] for edge in graph["edges"])
        assert vault.document("c")["chunks"][0]["text"] == "Isolated document"
        assert client.put(path, json={"icon": "none"}).json()["options"] == {**original, "icon": "none"}
        for invalid in [{}, {"icon": "<img>"}, {"icon": "book", "shape": "square"}]:
            assert client.put(path, json=invalid).status_code == 422
        assert client.put("/files/knowledge-base/graph/symbols/missing", json={"icon": "book"}).status_code == 404
