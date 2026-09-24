import pytest
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
