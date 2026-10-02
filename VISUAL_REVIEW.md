# Review and automatic visual classification

Open **Review & classify** inside Image Review, Image Manager, or Media Manager.
The panel stays collapsed until opened. Reviewing and classifying never modify
original images or videos, move files, or associate a person with a character.

## Reviewing

Image Review and Image Manager support selection slideshows, captions, tags,
Like/Dislike/Return to review, and ZIP exports containing original image copies,
caption text, ratings, tags, and classification metadata. Editor, Gallery-folder,
and workflow handoffs use the existing image destination controls. Image Manager
uses the current selection, or the shown page when nothing is selected. Like
also sets Image Manager's existing Favorite flag. Existing tags remain usable.

Media Manager offers slideshow review of selected video previews, ratings,
captions, tags, person/scene filters, and preview-image/notes ZIP exports under
its scan reports' `review-exports` folder. Existing Media Manager folder and file
actions still handle videos. It does not send videos into image editing tools.

## Automatic grouping

1. Scan chosen source folders in Image Manager, or upload images in Image Review.
2. Open Review & classify. Enable **Group faces** and optionally choose an
   installed Ollama vision model for scene classification.
3. Choose **Classify selection**, or **Classify unprocessed catalog** to process
   visible catalog images without selecting them page by page. Catalog batches
   contain up to 1,000 images; repeat to continue. Completed classifications are
   reused. Rescanned changed files are classified as new content.
4. Name a person group once. Future matching faces join the group automatically.
   An image containing multiple people appears under each matching person.
5. Filter by person, setting, rating, or text. Correct any mistaken matches with
   separate-person, assign-person, exclude-face, or merge-group controls. Scene
   labels are editable. Corrections remain in place on subsequent cached runs.

### Naming and correcting people in Image Manager and Image Review

Click a person’s face card to open their photos. **Rename person** changes the
name throughout that group. **Merge with another person** shows both faces and
the name the combined group will keep before you choose **Merge groups**.

Open any photo to see **People in this photo** beside the image. Choose a face,
then either save its group’s name or use **Change person** to move just that
face to an existing person or a new person with an optional name. Other faces
and unfinished caption/tag edits are preserved. **Not a face** removes a false
detection from grouping. **Undo last face correction** restores the last move
or removal while that photo remains open; it does not undo group merges.

People and scene choices remain available when filtering photos. Counts on
person cards describe all their visible, current photos in this workspace;
the result count reflects the active filters. Search also matches person names.
Locked, hidden, and stale source files remain excluded from these choices.

Faces use the existing SCRFD + ArcFace provider. The first version requires a
detection confidence of 0.6, a face of at least 32 pixels, a cosine similarity
of 0.60, and a 0.08 margin over the next candidate. These are conservative
defaults, not calibrated accuracy guarantees. Ambiguous faces start separate
groups; two detected faces in the same image do not automatically merge.
Small, obscured, stylized, or widely varying faces may need manual correction.
Groups are anonymous until named by the user; models never infer real names.

Scene classification uses a fixed vocabulary of visible settings and subjects,
such as indoors, outdoors, park, beach, forest, kitchen, food, or illustration.
It does not infer sensitive personal traits. Scene inference never overwrites
manual captions, tags, or corrected scene labels. A model must be installed;
this feature performs no automatic model downloads.

## Media Manager scope

This initial video pipeline classifies the existing full-size preview frame,
not every frame or the whole video's changing scenes. It can therefore miss
people or settings elsewhere in a video. Batches and exports are limited to 20
videos. Full-file hashes are checked before sending preview bytes. Original
paths and videos stay inside Media Manager; only bounded preview images and
catalog identifiers cross its server-side review bridge.

The embedded view retains its separate browser session and same-origin network
restriction. Its renderer never receives Workstation's session credential. A
separate server credential is accepted only for `/visual-review/media/*`, with
additional source checks on person/face corrections. Other Workstation routes
continue to require the normal session credential. Standalone Media Manager
reports that this integration requires the desktop host.

## Persistence and operation

### Phase 1: manual-review metadata foundation

The REVIEW audit found three storage adapters: Image Review uses the owned
image-library index, Image Manager uses its image catalog, and Media Manager
uses its restricted server bridge. Captions, tags, Like/Dislike, selection,
slideshow navigation, exports, and optional classification already exist.
Category, project, and explicit review status now have a shared persistent
contract, along with media identity, current location, and file state. This
phase adds the storage/API foundation and read-only saved details; new review controls and
Save & Next belong to Phase 2. File transfers, presets, and coordinator commands
remain later phases.

| Field | Contract |
| --- | --- |
| `schema_version` | Response/storage version `1`; supplied by the server |
| `media_id` | Stable namespaced workspace/item ID, distinct from the content hash |
| `media_type` | `image` or `video`; supplied by the source adapter |
| `path` | Current absolute path from the source adapter, or last known path when storage is unavailable; never writable by review requests |
| `file_state` | `present`, `missing`, `unavailable`, `changed`, or `unchecked`; refreshed from source filesystem metadata |
| `metadata` | Existing origin/linkage and technical image metadata; original source records and files remain authoritative |
| `tags` | Ordered unique tag names; trimmed, at most 100 names of 1–80 characters |
| `category` | One manual label, trimmed, at most 120 characters; empty means unassigned |
| `project` | One manual project label, trimmed, at most 120 characters; empty means unassigned |
| `favorite` | Boolean, independent of accepted/rejected status |
| `review_status` | `unreviewed`, `accepted`, or `rejected` |
| `rating` | Compatibility field: `null`, `liked`, or `disliked`, respectively |
| `caption` | Existing manual notes, at most 10,000 characters |

Image Manager retains its existing limit of 20 tags of at most 60 characters;
Media Manager retains its 60-character tag limit. Their native tag catalogs and
favorite flag remain authoritative. `project` is a review label, not a link to
a training project or a filesystem destination. Category and project do not
trigger classification, folder creation, moves, or copies.

`POST /visual-review/review` saves a patch: omitted fields stay unchanged.
Empty strings/lists clear labels/tags; `favorite: false` clears favorite;
`review_status: "unreviewed"` returns the item to review. `null` is allowed only
for the legacy rating. Status and rating must agree if both are supplied.
Unknown fields, invalid values, and conflicting status/rating return 422.
Existing `PATCH /image-library/images/{id}` also accepts category, project,
favorite, and review status. The existing REVIEW panels preserve these fields
while saving captions and tags.

For example, a review patch for an existing image is:

```json
{
  "source": "library",
  "id": "<existing image ID>",
  "category": "Reference",
  "project": "Autumn album",
  "favorite": true,
  "review_status": "accepted"
}
```

The library listing exposes identity, path, state, and metadata alongside review
fields. Visual-review open/catalog responses include the common record as
`media`, alongside existing `review` and `classification` objects. The isolated
video bridge reports type `video`, path `null`, and state `unchecked`: the host
cannot prove current video-file availability and receives no original path.
Media Manager retains its existing `CurrentPath` scan/action records locally.

Visual-review ZIP metadata includes saved manual-review fields. Catalog APIs accept exact
case-insensitive `category` and `project` filters, a boolean `favorite` filter,
and `review_status`. Text search also includes category/project. These filters
apply to registered visible review sources; they do not automatically scan or
register the rest of a media library.

Owned library images save the fields in their existing internal index.
External source records save them in `source_reviews`, keyed by workspace,
item ID, and content hash. Classification embeddings/scenes remain shared by
content hash, but changing a copy's review notes/status/project does not change
another copy's record. Replacing a file's content starts a fresh review record;
returning to its previous hash recovers its previous metadata. Media Manager's
existing native tag assignments still apply to matching full-file hashes.

Legacy library records receive defaults when read, without rewriting the index:
Like becomes accepted and initially favorite; Dislike becomes rejected; no
rating becomes unreviewed. Defaults are persisted on the next edit. Existing
hash-keyed SQLite reviews are copied into source-specific records on first use;
the original review table remains intact. Image Manager's native favorites
without saved review records receive accepted status once on first use. After
that migration, toggling favorite does not change status. For old Image Manager clients that
send a rating without favorite, Like still sets its native Favorite flag.
Clients using review status, or sending favorite explicitly, can set each
independently. Updates from the native Favorite control never alter saved status.

Metadata stays inside app storage and existing backup/reset coverage. No source
file bytes, gallery IDs, folder membership, or chat/workflow references are
rewritten. No new metadata files are created alongside originals. Verification
uses temporary synthetic image/media fixtures and covers legacy reads,
persistence, repeated tags, partial updates, validation, filtering, independent
copy records, source replacements, and original-byte preservation.

### Architecture audit: identity, storage, sources, and missing files

Image REVIEW (`src/components/ImageReview.jsx`) reads the owned library through
`useImageLibrary` and `/image-library`. Library records use an existing random
32-character image ID and live in `LAW_DATA_DIR/image_library/index.json`.
Image bytes use `image_library/images/{id}.image`. Gallery collections are
logical `folder_ids`, not physical folders. Review edits retain both the
original image ID and those collections.

The owned library deduplicates imports by SHA-256 while keeping the existing
record's ID, caption, tag IDs, rating, and metadata. Upload/review origins are
marked `review_only`. Chat/generated and workflow images enter this library
through typed source IDs and an owned copy. Their `origin` retains session,
message/image, or workflow/job/output references. Seed is read from existing
PNG metadata when present. Prompt/model/generation recipes remain in their
original source records and image bytes; this foundation neither fabricates
them nor rewrites them. Unknown existing library fields are retained on save.

Physical paths resolve through `services/storage_libraries.py`, including
registered secondary app storage. Library imports/edits persist current path,
media identity/type, and the last checked state in the internal index. Legacy
records derive them on read and persist them on their next edit. An unavailable
drive keeps the last saved location. Read/list operations do not rewrite the
library index simply to migrate or check availability.

Image Manager uses its separate SQLite image/folder catalogs. Its existing
image ID is stable; the authoritative path is the registered folder path plus
the stored relative filename. Its `available` flag and file signature still
govern serving and use. Visual-review source records save a location/technical
snapshot when a source is opened. Current record responses derive the path from
the catalog, so stale snapshot paths never authorize file access. Missing
registered sources remain visible in review after rescanning, with their saved
review records and IDs intact. Changed content must be rescanned before saving
new review decisions.

File checks inspect metadata, not image contents or vision models. Missing
means the file cannot be found; unavailable also covers disconnected storage,
permissions, and rejected links/junctions. REVIEW displays a message instead of
a broken preview, keeps saved classifications readable, and disables image
handoffs/exports that require the file. Restoration followed by refresh/reopen
recovers the preview under the same media ID. Content reads and export still
perform their existing signature/hash and privacy checks. Path and media-ID
fields are server-owned and rejected as review edits.

The Phase 1 persistence milestone is exercised with two separate Python backend
processes against a temporary app-data folder: the first creates and classifies
a synthetic generated image, then exits; the second uses the listing/open APIs
to verify category, project, tags, favorite, status, path, seed, and source
linkage. Missing/restored files and disconnected storage are separate fixture
tests. This is a backend restart test; it does not restart a user's running
desktop app or claim live desktop/GPU validation.

The shared SQLite catalog is `LAW_DATA_DIR/visual_review/catalog.sqlite3`.
It contains source IDs, hashes, small face previews, embeddings, person names,
scene labels, review metadata, and job summaries. It is personal app data and
is included in app backups/reset. Originals keep their existing storage paths;
Media Manager scan/tag metadata retains its separate existing storage rules.
Locked-image hashes are excluded from classification browsing and face previews.

Jobs use the shared inference queue and continue across tab changes. Stop keeps
completed results; a restart marks unfinished batches interrupted rather than
automatically resuming. Failed items can be retried without redoing completed
face or scene analysis. CPU face inference does not reserve image-generation
VRAM; scene inference uses the GPU queue. Saved names and classifications are
suggestions to review, not proof of identity or location.

## Routes and pipeline

The normal authenticated API is rooted at `/visual-review`:

| Route | Purpose |
| --- | --- |
| `GET /capabilities` | Installed provider readiness and supported labels |
| `POST /open`, `POST /review` | Read or save a catalog item's review metadata |
| `POST /classify` | Queue explicit source IDs from `library` or `image-manager` |
| `POST /classify-catalog` | Queue visible items missing requested analysis |
| `GET /job`, `POST /stop` | Persistent progress and cooperative cancellation |
| `GET /catalog` | Paginated person, scene, rating and text filters |
| `POST /person`, `/face`, `/merge`, `/scenes` | User naming and corrections |
| `GET /faces/{id}`, `POST /export` | Guarded face previews and image/notes ZIPs |

Source adapters validate bytes and hashes, then queued face detection produces
embeddings and similarity groups. Optional vision inference produces validated
scene labels. Stages persist independently, so failed scene inference does not
discard completed faces. Content hashes reuse classifications across copies;
source IDs keep workspace locations distinct. Discovery entries in Tools expose
the normal classification routes and schemas without granting automatic execution.
The Media Manager proxy uses only the separate `/visual-review/media/*` subset.

## Verification boundaries

Backend tests cover cross-image grouping, multiple faces, ambiguity, manual
corrections, hash changes, original-byte preservation, library metadata and
exports, locked-image guards, cancellation, and the restricted Media bridge.
Browser integration uses synthetic images/videos and simulated inference with
real APIs, queue, SQLite, file reads, and FFmpeg thumbnails. The installed CPU
face engine also completed inference on a generated test graphic. This is not
an accuracy evaluation against a real personal photo collection.
