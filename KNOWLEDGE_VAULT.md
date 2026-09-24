# Knowledge vault

Knowledge opens a dedicated document graph alongside a searchable file list and
indexed-text reader. Uploads and individual/bulk removal operate on the existing
RAG index. Removing a document removes its indexed chunks and vault relationships;
the original source file is unchanged. Use Knowledge in chats controls retrieval.

Each node is one indexed document. Its size reflects the number of indexed chunks.
Connections have explicit meanings:

- **Manual**: use Connect in the document inspector; Unlink removes this relationship.
- **Document link**: imported text contains `[[filename]]`, `[[filename#heading]]`,
  or `[[filename|label]]`. Matching accepts full names or extensionless names,
  case-insensitively. Ambiguous/missing targets are reported without making a link.
  Update the imported source and reimport it to change these links. A relationship
  may have both kinds; unlinking a manual connection retains a source-text link.

Lines do not imply semantic similarity, and disconnected documents still take
part in RAG. Self links are omitted, and overlapping chunks do not duplicate edges.
Node dragging saves positions; drag the background to pan, scroll or use +/- to
zoom, and choose Fit graph to bring all documents into view. Nodes also support
keyboard focus and Enter/Space. The reader paginates chunks in source order and
labels them because indexed text can overlap between chunks.

## Storage and API

The existing local ChromaDB collection remains the source of indexed documents
and RAG embeddings. Its internal database is not modified directly. Explicit
undirected links and node positions live in `knowledge_base/vault.sqlite3`, under
the configured app data root, so ordinary app backup/import/reset includes them.
Graph links do not change retrieval ranking or prompt construction.

- `GET /files/knowledge-base/graph`: all document nodes and resolved relationships.
- `POST` / `DELETE /files/knowledge-base/graph/links`: `{source, target}`.
- `PUT /files/knowledge-base/graph/positions/{doc_id}`: finite bounded `{x, y}`.
- `GET /files/knowledge-base/documents/{doc_id}?offset=0&limit=30`: indexed text.

Graph reads page through chunk text without loading embeddings or running inference.
Document IDs are validated against the index before mutations, SQL is parameterized,
and the usual app session/maintenance guards protect the routes. Filename/content
strings render as text in the frontend.

## Verification

`test_knowledge_graph.py` exercises real temporary Chroma and SQLite stores, wiki
link resolution, ambiguity, persistence, deletion cleanup, ordered pagination and
route validation. `knowledgeGraph.test.jsx` checks layout, accessibility, escaping
and API failures. `scripts/qa-knowledge-vault.cjs` uses the production frontend and
real graph endpoints with a synthetic, disposable index in a hidden Electron
window. It checks connected nodes, document reading, link/unlink, pointer dragging,
reload persistence and a 390-pixel layout. No user documents or live desktop
windows are involved; no real embedding/model inference is exercised.
