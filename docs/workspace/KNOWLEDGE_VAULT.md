# Knowledge vault

Knowledge opens a rotatable 3D document graph alongside a searchable file list and
indexed-text reader. Uploads and individual/bulk removal operate on the existing
RAG index. Removing a document removes its indexed chunks and vault relationships;
the original source file is unchanged. Use Knowledge in chats controls retrieval.

**New node** creates and selects an untitled node immediately, then opens its
details in the inspector with the title selected for editing. Choose Note,
Character, Idea, Project, Place, Event, or Reference and add your criteria/content.
The title and type preview in the graph and list while editing. **Save content**
persists the changes on that same node. Each type supplies a starting color,
shape and searchable type tag. Node symbol and Customize node let you change these afterward. Creation
uses the existing local embedding queue, so the configured embedding model must
be available. Creating a node and closing its inspector leaves the untitled node
in the vault. Unsaved detail edits are marked and should be saved before selecting
another node or reloading. Repeated clicks during creation do not create duplicates;
if refreshing fails after creation, **Open created node** retries that node.

Created nodes open automatically in the graph. **Edit node details** in their
inspector updates the title, type, and original text, then reindexes that document.
Edits keep its document identity, connections, and 3D position. Type changes update
color and shape when they still match the previous type's defaults while keeping
customized fields and the saved symbol. Different nodes can share a title without overwriting documents.
Use `[[node title]]` to link to a created node; duplicate titles are reported as
ambiguous. Filename links continue to work for uploaded and character documents.

Choosing **Character** reveals character notes and an optional saved profile
selector. Linking a profile stores its ID and offers **Open linked character**;
it preserves your node notes without copying or changing the profile. A character
node also works without any saved profile. Saving a different node type removes
that association and keeps the node's content, identity and connections. This
works for previously authored nodes as well as newly created ones.

**Start character node** creates a document from a saved [Character Creator](../images/CHARACTERS.md)
profile. Its inspector provides a profile path, **Open character**, **Refresh
character node**, and a copyable Knowledge link. These documents are snapshots;
save character edits and refresh the node when you want its indexed text updated.

Saved **Index** entries can connect to existing nodes through **Connect to
Knowledge** in Index. The selected node's **Index entries** section opens each
connected entry or removes its link. These references use stable entry and
document IDs, so edits and renames preserve them. Removing either item removes
its references while leaving the other item intact. Links are stored alongside
the vault relationships in `vault.sqlite3` and included in normal app backups.
Index entry text stays in Index; linking alone does not add it to the RAG index.

Each node is one indexed document. Its default size reflects the number of indexed chunks.
**Node symbol** is always available in the inspector and saves automatically,
without opening Customize node. Choose Document, Star, Person, Idea, Book, Flag,
Check, or explicitly No symbol. Uploaded documents start with a document symbol.
Symbols stay visible in the graph while rotating and zooming, and survive reloads,
appearance presets, resets, and node type edits. An unsaved appearance preview
also keeps a newly saved symbol.

Select a document and open **Customize node** in its inspector to change:

- Display name, color, and circle/square/diamond/hexagon shape.
- Solid/dashed/no border, fixed size or size based on chunks.
- Short/full/hidden graph labels and label text size.
- Searchable tags and a node note, plus a position lock to keep its placement.

Six appearance presets (Document, Person, Idea, Reference, Priority, Complete)
provide starting styles. Changes preview immediately; **Save node** persists them,
**Cancel** restores the saved style, and **Reset options** previews defaults until
saved. Presets and resets preserve the saved symbol. Switching documents discards an unsaved preview. Display names leave the
source filename and wiki-link matching intact. Tags and notes organize the graph;
they do not alter indexed text or retrieval. Search matches saved names, filenames,
tags, and notes. Locked nodes remain selectable; unlock and save to move them.

Connections have explicit meanings:

- **Manual**: use Connect in the document inspector; Unlink removes this relationship.
- **Document link**: imported text contains `[[filename]]`, `[[filename#heading]]`,
  or `[[filename|label]]`. Matching accepts full names or extensionless names,
  case-insensitively. Ambiguous/missing targets are reported without making a link.
  Update the imported source and reimport it to change these links. A relationship
  may have both kinds; unlinking a manual connection retains a source-text link.

Lines do not imply semantic similarity, and disconnected documents still take
part in RAG. Self links are omitted, and overlapping chunks do not duplicate edges.
The graph places documents in an actual x/y/z volume and uses perspective,
depth ordering, a spatial grid, and an orientation indicator. Labels face the
camera and stay readable while rotating. Controls are:

- Drag the background to rotate freely around the graph, including full turns.
- Shift-drag or right-drag the background to pan; scroll or use +/- to zoom.
- Drag an unlocked node to move it in the current camera plane. Alt-drag a node,
  or select it and use **Deeper**/**Closer**, to move through depth.
- **Fit graph** frames the volume while keeping the viewing angle; **Reset view**
  restores the starting angle. **Focus node** centers and zooms toward a selection.
- With the graph focused, arrow keys rotate; +/- zoom and 0 resets. With a node
  focused, Enter/Space selects, arrows move, and Page Up/Down changes depth.

Dragging and depth controls save the full x/y/z position. Rotation, pan, zoom,
and focus change the camera without moving documents. Old x/y layouts remain
intact and receive stable initial depth; moved or newly locked nodes save all
three coordinates. Existing position locks still apply in 3D. The reader
paginates chunks in source order and labels them because indexed text can overlap.

## Storage and API

The existing local ChromaDB collection remains the source of indexed documents
and RAG embeddings. Its internal database is not modified directly. Explicit
undirected links, node positions, customization, and the original content of nodes
created in Knowledge live in `knowledge_base/vault.sqlite3`, under
the configured app data root, so ordinary app backup/import/reset includes them.
Graph links do not change retrieval ranking or prompt construction.

- `GET /files/knowledge-base/graph`: all document nodes and resolved relationships.
- `POST /files/knowledge-base/nodes`: `{title, kind, text}` creates and indexes a
  general node with a unique filename. `text` is optional and defaults to empty.
- `GET` / `PUT /files/knowledge-base/nodes/{doc_id}`: read/edit a node created in
  Knowledge. Uploaded documents and character snapshots use their existing workflows.
- `POST` / `DELETE /files/knowledge-base/graph/links`: `{source, target}`.
- `PUT /files/knowledge-base/graph/positions/{doc_id}`: finite bounded `{x, y, z}`.
  Legacy requests may omit z and retain any saved depth. The SQLite schema migrates
  existing position rows without rewriting their x/y values.
- `PUT /files/knowledge-base/graph/options/{doc_id}`: validated node options;
  omitted fields reset to defaults. Returns the normalized `options` object.
  Position changes for saved locked nodes return HTTP 409.
- `PUT /files/knowledge-base/graph/symbols/{doc_id}`: `{icon}` saves just the symbol,
  preserving all existing appearance, organization, connections, and position.
  Returns normalized `options`.
- `GET /files/knowledge-base/documents/{doc_id}?offset=0&limit=30`: indexed text.

Graph reads page through chunk text without loading embeddings or running inference.
Document IDs are validated against the index before mutations, SQL is parameterized,
and the usual app session/maintenance guards protect the routes. Filename/content
strings render as text in the frontend.

## Verification

`test_knowledge_graph.py` exercises real temporary Chroma and SQLite stores, wiki
link resolution, ambiguity, persistence, deletion cleanup, ordered pagination and
route validation, xyz persistence, and legacy SQLite migration.
`test_knowledge_notes.py` covers creation, duplicate titles, blank content, editing,
preserved styles/relationships/positions, title links, removal, route validation,
and preservation of the previous source and index when embeddings fail.
`knowledgeGraph.test.jsx` and `knowledgeGraph3D.test.js` check layout, perspective,
full rotations, camera-relative movement, framing, accessibility, escaping,
and API failures. `scripts/qa-knowledge-vault.cjs` uses the production frontend and
real graph endpoints with a synthetic, disposable index in a hidden Electron
window. It checks connected nodes, document reading, link/unlink, pointer dragging,
3D orbit/pan/zoom, depth ordering, reset, xyz persistence,
reload persistence, standalone symbol saving with customization collapsed,
symbols preserved through presets/resets and source type edits,
customization previews/saving/cancellation, tag search,
position locking, a 390-pixel layout, and creation/editing/reload of general nodes.
The creation fixture uses synthetic embeddings. No user documents or live desktop
windows are involved; no real embedding/model inference is exercised.
