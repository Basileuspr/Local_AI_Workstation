# Knowledge vault

Knowledge combines a document graph, searchable file list and indexed-text reader.
Upload explicitly, install the configured local embedding model, then enable
Knowledge in chat to retrieve relevant chunks. Removing a document removes its
index/relationships; the original source file remains unchanged.

## Create and edit nodes

**New node** immediately creates an untitled node and opens its details. Choose
Note, Character, Idea, Project, Place, Event or Reference, then **Save content**.
Closing without deleting leaves that node present; unsaved detail edits still
need saving. If refresh fails, **Open created node** retries the existing identity.

Edit node details updates title, type and original text, then reindexes that same
document. Identity, connections and position survive. Duplicate display titles
are allowed, but a wiki-link matching multiple targets is reported ambiguous.

A Character node can link a saved profile without copying or altering it.
**Start character node** creates a profile snapshot; refresh it explicitly after
changing the saved character. See [Characters](../images/CHARACTERS.md).

Index entries can connect to Knowledge nodes by stable IDs. Linking does not
embed the Index entry’s text. Removing either item removes the relationship while
leaving the other item intact.

## Appearance and connections

Node symbol saves independently. Customize node previews color, shape, border,
size, labels, tags, notes and position locking; Save persists and Cancel restores.
Changing documents discards an unsaved appearance preview. Tags/notes organize
the graph but do not alter indexed document text or retrieval.

Manual connections and source-text links are distinct. Supported wiki-links use
`[[filename]]`, `[[filename#heading]]` or `[[filename|label]]`; created nodes
can use their title. Missing/ambiguous targets do not create a guessed link.
Unlinking a manual connection preserves a relationship also present in source
text. Reimport or edit that source to change its text-derived links.

Graph lines do not imply semantic similarity. Disconnected documents still
participate in retrieval when selected.

## Navigate the graph

The 3D view encloses the documents in a visible frame with a floor grid. Dotted
guides join each node to a floor marker so its height and depth are easier to
judge. **Space guides** toggles these aids without moving any documents. Bright
solid lines are manual links; dashed violet lines are document links. Selecting
a node emphasizes its connections while keeping the rest of the graph visible.
Labels use dark backplates and spread around crowded nodes, with small leader
lines connecting each label to its document. Label placement never changes saved
document positions.

The counter shows how many node centers are in view. If you pan or zoom past
documents, **Show all nodes** brings the whole space back while keeping your
viewing angle. The orientation compass stays in the corner, and selecting a
node shows its saved-space X/Y/Z coordinates below the graph.

Drag the background to rotate; Shift/right-drag pans; scroll or +/- zooms.
Drag an unlocked node in the camera plane, or Alt-drag / Deeper / Closer to change
depth. Fit graph preserves viewing angle; Reset view restores it; Focus node
centers the selection.

With graph focus, arrows rotate and 0 resets. With node focus, Enter/Space selects,
arrows move and Page Up/Down changes depth. Positions save in three dimensions;
camera movement does not move documents. Locked nodes remain selectable.

The indexed-text reader shows chunks in source order. Overlap is deliberate and
does not mean the source contains duplicate paragraphs.

[Web sources](../development/WEB_SYSTEM.md) · [Storage](STORAGE_AND_BACKUP.md)
