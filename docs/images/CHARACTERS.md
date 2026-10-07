# Character Creator

Open **Characters & Training → Character Creator** to create named characters,
save a biography, notes and tags, and connect identifying resources. Existing Character Bank profiles
appear here using the same IDs and files; no migration or duplication is needed.
**New character** can start a profile before it has any faces.

**Faces** remains the extraction workspace. From Character Creator, open Face
Extractor, select crops, and choose **Add to [character name]** to add references
to the selected character. **Save as character** instead creates a new profile
and opens it in Character Creator. Source images and dataset crops stay in place.

Audio and Packager have **Open Character Creator** shortcuts showing the last
selected character. Character Creator also has shortcuts back to Audio and
Packager. Changing workspace keeps unsaved audio and package selections in their
existing panels. Selected character and workspace persist across app restarts.

## Reference library

Each character can link library images, Face Extractor datasets, Character Parts
datasets, LoRA projects, trained adapters, Knowledge documents, other characters,
and saved files. These
are explicit associations with stable source IDs; linking does not move files,
train a model, or infer someone's identity. Resources can belong to multiple
characters. Reference notes describe the relationship or hold a voice transcript.
Face datasets open in Faces, part datasets in Character Parts, projects in LoRA,
and documents in Knowledge.

The same ties can be made from the other side. **Faces**, **Character Parts** and
**LoRA** each show an optional **Characters** panel for the open dataset, project
or trained LoRA. It lists the characters already tied to it, with **Open
character** and **Untie**, and **Tie to character** adds one with an optional
note. The workspace's selected character is chosen by default. Nothing is tied
automatically. Tying a whole face dataset is separate from the accepted face
references a profile holds; neither changes the other. Untie and deleting a
dataset or project behave like Unlink above: the other side is kept.

**Upload reference file** saves a local copy of images, videos, audio, documents, model
files, or other identifying material (128 MiB per file, 500 links per character).
The shared upload library deduplicates identical file bytes. Large trained LoRAs
can be linked without copying through their project/adapter. Image previews,
video playback/seeking/fullscreen, and audio playback are available in the
profile. Images accept PNG, JPEG, WebP, GIF (including animation), BMP, AVIF,
and TIFF up to 24 megapixels. Video containers include MP4, MOV, WebM, MKV,
AVI, WMV, FLV, MPEG, TS/MTS, OGV, and 3GP. Preview support depends on the codec
and the app's browser; unsupported previews display a save-file fallback.
Saved originals keep their exact bytes. Audio-only WebM/MP4 remains an audio
reference when the local media decoder is available. Older uploads gain the
new previews without uploading again. Playback pauses when leaving Characters.
Other files can be downloaded.
Locked images are excluded from linking, upload reuse, and file access.

**Unlink** removes only the association. Source resources and saved upload copies
remain intact; choose **Saved file** to reuse an upload, including one whose
previous character was deleted. Missing sources are shown as unavailable, with
their link and notes retained. Uploads live in `face_bank/assets`, within the
existing character backup/reset scope. Ordinary source files are never removed.

In Audio, **Save recording / voice reference / generated voice / transcript to
[character]** attaches the corresponding item to the selected character. Voice reference audio retains its entered
transcript as reference notes. From the profile, **Use as voice reference** opens
Audio; **Load saved voice reference** explicitly replaces the current reference.
Review the loaded words before generating; a general audio note may not be a
verbatim transcript. Nothing plays, records, or generates automatically.

## Knowledge nodes

Choose a character and **Start / open Knowledge node**, or use **Knowledge →
Start character node** to select one. **Create character node** indexes a
Markdown snapshot of its saved biography, notes, tags, linked-resource inventory,
reference notes, and accepted face-reference IDs. It
uses the configured local Knowledge embedding model. Save profile edits before
creating or refreshing the node. Linked Knowledge documents become wiki links
in that snapshot, connecting them through the existing graph. Opening the
workspace never indexes anything.

The document inspector shows **Open character**, **Refresh character node**, and
**Copy Knowledge link**. It also shows `face_bank/<character-id>.json`, a path
relative to the app's configured data directory. Face images, embeddings, and
absolute source-file paths are not included in the document.

Renaming a character retains its existing node and graph connections. Refresh
updates the document text; its original filename remains stable for links.
Removing a Knowledge node does not delete the character or any crops. Deleting
a character leaves the indexed snapshot; opening its old pointer reports that
the profile no longer exists. Knowledge settings still control retrieval in chat.

## Roleplay and response influences

Use **Load saved profile into roleplay** in Character Creator, or load the selected
profile from Chat's **Response influences** panel. This copies the saved name,
biography, and notes into a fresh roleplay setup. It replaces previous character
fields and disables the general system prompt, response style, and saved user
memory overlays. These overlays can be enabled individually. Existing Knowledge
scope is preserved and visible; an all-document scope shows a conflict warning.
Linked media, LoRAs, parts, and documents are not automatically attached to chat.
Browsing another profile does not change the loaded roleplay character.

Roleplay and prompt settings currently apply across chats. The panel previews
the next submitted message; queued messages keep their submitted settings.
Earlier dialogue and rolling summaries remain context after a character change,
so start a new chat for a clean change. Editing roleplay fields edits a snapshot,
not the saved character profile. Roleplay presets are separate from profiles.

Each new text reply keeps a local request record from the final provider payload:
model/options, ordered instructions, bounded history excerpts, image counts, and
actual memory/Knowledge inclusion or failure. Document and canvas modes record
their additional instructions and effective options. Older replies without a
record are marked **not recorded**, not inferred from today's settings. These
records describe supplied inputs, not their causal weight or whether the model
followed them. They exclude image bytes, cap text at 96,000 characters and 500
messages, and include fingerprints for truncated text. Records are saved with
chat data and can contain private prompt, memory, and retrieved document text;
chat-data backups include them. Receipts themselves are not fed into later chats.

## Verification

`tests/frontend/characterKnowledge.test.js` checks stable pointers, safe document
filenames, and snapshot content. Existing navigation, face-bank and Knowledge
tests cover the reused controls and stores. After `npm run build`, run:

```powershell
.\node_modules\.bin\electron.cmd scripts/qa-character-workspace.cjs
```

This uses the production interface with disposable character profiles, synthetic
face references, and a real temporary Chroma/SQLite index. Embeddings are fixed
test vectors; it does not exercise model inference or access personal data.
It checks shortcuts, creation with/without faces, biography/notes, linked parts,
file upload, real audio decoding, saved voice-reference handoff, corrected voice
transcript persistence, duplicate avoidance, unlink preservation, Knowledge node
creation/refresh, rename stability, package selection, and reload persistence.
Reports and screenshots go under ignored `artifacts/character-workspace-smoke`.

`tests/frontend/chatInfluences.test.jsx` and `tests/backend/test_chat_influences.py`
check prompt composition, snapshot provenance, effective provider inputs, source
failures, opt-out behavior, and bounded records. After building, run
`electron scripts/qa-chat-influences.cjs` to exercise both loading controls,
queued settings, saving/reloading historical records, and narrow layouts in the
production desktop UI. Model output and retrieval use synthetic fixtures in
disposable stores; this checks request accuracy, not model roleplay quality.
