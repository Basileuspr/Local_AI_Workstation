import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.prompt_index import router
from services import knowledge_base as kb, knowledge_graph as vault, prompt_index_store as index
from services import index_knowledge_links as links
from services.knowledge_node_options import KnowledgeNodeOptions


@pytest.fixture
def linked_sources(tmp_path, monkeypatch, prompt_index_paths):
    monkeypatch.setattr(kb, "KB_DIR", tmp_path / "knowledge")
    collection = kb._get_collection()
    collection.add(ids=["a_0", "b_0"], documents=["Project details", "Research notes"], embeddings=[[1., 0.]] * 2,
                   metadatas=[{"doc_id": id, "filename": name, "chunk_index": 0, "total_chunks": 1}
                              for id, name in [("a", "Project.md"), ("b", "Research.md")]])
    # Linking must never ask for embeddings or change Knowledge contents.
    monkeypatch.setattr(kb, "_create_embeddings", lambda *args, **kwargs: pytest.fail("Unexpected indexing"))
    entry = index.create_entry("Research snippet", "Saved source text", "Reference", ["research"])
    return entry


def test_links_are_explicit_persistent_many_to_many_and_preserve_sources(linked_sources):
    entry = linked_sources
    original_graph = vault.graph()
    links.set_link(entry["id"], "a")
    links.set_link(entry["id"], "a")
    links.set_link(entry["id"], "b")
    other = index.create_entry("Other note", "Independent text")
    links.set_link(other["id"], "a")
    assert len(links.catalog()["links"]) == 3
    assert len(links.catalog(entry_id=entry["id"])["links"]) == 2
    assert len(links.catalog(doc_id="a")["links"]) == 2
    assert next(item for item in index.list_entries() if item["id"] == entry["id"]) == entry
    assert vault.graph() == original_graph
    with vault.database() as connection:
        assert connection.execute("SELECT COUNT(*) FROM index_links").fetchone()[0] == 3


def test_connections_follow_ids_after_entry_and_node_names_change(linked_sources):
    id = linked_sources["id"]
    links.set_link(id, "a")
    index.update_entry(id, "Renamed snippet", "Updated reference")
    vault.set_options("a", KnowledgeNodeOptions(label="Project hub"))
    assert links.catalog()["links"] == [{"entry_id": id, "doc_id": "a", "entry_title": "Renamed snippet", "node_label": "Project hub"}]
    assert next(node for node in links.catalog()["nodes"] if node["doc_id"] == "a")["label"] == "Project hub"


def test_missing_sources_cannot_be_linked_and_stale_links_can_be_unlinked(linked_sources):
    with pytest.raises(LookupError, match="Index entry"):
        links.set_link("missing", "a")
    with pytest.raises(LookupError, match="Knowledge node"):
        links.set_link(linked_sources["id"], "missing")
    links.set_link("missing", "missing", remove=True)
    assert links.catalog()["links"] == []


def test_unlink_removes_only_the_relationship(linked_sources):
    links.set_link(linked_sources["id"], "a")
    links.set_link(linked_sources["id"], "b")
    links.set_link(linked_sources["id"], "a", remove=True)
    assert [item["doc_id"] for item in links.catalog()["links"]] == ["b"]
    assert index.list_entries() == [linked_sources]
    assert len(kb.list_documents()) == 2


def test_knowledge_removal_cleans_links_and_preserves_index(linked_sources):
    links.set_link(linked_sources["id"], "a")
    links.set_link(linked_sources["id"], "b")
    assert kb.remove_document("a")
    assert [item["doc_id"] for item in links.catalog()["links"]] == ["b"]
    with vault.database() as connection:
        assert connection.execute("SELECT doc_id FROM index_links").fetchall() == [("b",)]
    assert index.list_entries() == [linked_sources]


def test_routes_validate_links_and_index_deletion_cleans_only_its_links(linked_sources):
    app = FastAPI(); app.include_router(router)
    pair = {"entry_id": linked_sources["id"], "doc_id": "a"}
    other = index.create_entry("Other", "Other content")
    links.set_link(other["id"], "a")
    with TestClient(app) as client:
        assert client.post("/prompt-index/knowledge-links", json=pair).status_code == 200
        assert client.post("/prompt-index/knowledge-links", json=pair).status_code == 200
        assert client.get("/prompt-index/knowledge-links", params={"entry_id": pair["entry_id"], "doc_id": "a"}).json()["links"][0]["entry_title"] == "Research snippet"
        for bad in [{**pair, "doc_id": "missing"}, {**pair, "entry_id": "missing"}]:
            assert client.post("/prompt-index/knowledge-links", json=bad).status_code == 404
        for bad in [{**pair, "doc_id": ""}, {**pair, "entry_id": "x" * 101}, {**pair, "extra": "bad"}]:
            assert client.post("/prompt-index/knowledge-links", json=bad).status_code == 422
        assert client.request("DELETE", "/prompt-index/knowledge-links", json=pair).status_code == 200
        assert client.post("/prompt-index/knowledge-links", json=pair).status_code == 200
        assert client.delete(f'/prompt-index/{pair["entry_id"]}').status_code == 200
    assert [item["entry_id"] for item in links.catalog()["links"]] == [other["id"]]
    assert len(kb.list_documents()) == 2
    with vault.database() as connection:
        assert connection.execute("SELECT entry_id FROM index_links").fetchall() == [(other["id"],)]


def test_old_orphaned_references_are_not_exposed(linked_sources):
    links.set_link(linked_sources["id"], "a")
    index.delete_entry(linked_sources["id"])
    assert links.catalog()["links"] == []
