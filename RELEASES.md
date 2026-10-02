# Local release records

## 1.0.1-dev - document, 3D and workspace follow-up (2026-10-02)

This source update follows public commit `8c01ac0`. It retains the development
version and incorporates the completed editor work with the accumulated
workspace changes. It is not a packaged stable release.

- Document Editor provides a Word-style ribbon with Python DOCX import/export,
  text formatting, lists, tables, pictures, page settings, find/replace, undo and
  local draft recovery. Pagination is approximate. Tracked changes, comments,
  citations, mail merge, macros and full Word document fidelity remain outside
  this first phase; import notices explain conversion limits.
- 3D Viewer & Editor adds selectable objects, transforms, undo/redo, geometry
  operations, materials and textures, measurement, editable project files and
  millimeter STL export. Existing Windows source-mesh repair remains available.
- Local Files supports document inspection/editing, read-only database browsing
  and timestamped video descriptions with an overall analysis summary.
- Image Manager, review metadata, classification, thumbnails, storage libraries,
  Hash Auditor and Folder Review extend local media and file workflows.
- Functions sequences, Index-to-Knowledge links, startup preferences, environment
  and context reporting, thinking traces and workspace controls are included.
- Workspace Info panels explain controls individually. Face cards support inline
  naming, and Hide tagged images is visible in the Image Manager toolbar.
- The browser retains its isolated profile with explicit site permissions.
  Desktop Exit and Exit & Restart wait for owned backend cleanup. Dashboard
  separates GitHub validation, local commit and push into explicit actions.

See [project status](PROJECT_STATUS.md) for the final snapshot's checks and
limits. Real GPU inference, training and voice quality are not revalidated by
this publication. Physical webcam capture for 3D textures needs a hardware test.
Private runtime data, model weights, recordings, generated media, local reports
and private development history remain excluded.

## 1.0.1-dev - reviewed GitHub source update (2026-10-02)

This update publishes the completed source changes reviewed on October 2. The
development version is retained; this is not a packaged stable release.

- Chat gains editable and pinnable Markdown checklists, tool and document side
  panes, adjustable dividers, and a collapsible sidebar.
- Session and image metadata share a revision-keyed cache. Stale history saves
  are rejected, while replies and metadata changes preserve newer messages.
- Knowledge supports authored notes, node presentation settings and a 3D graph.
  Character resource associations remain explicit.
- Generate adds validated reference-image variations, clearer batch results,
  image destinations, seeds and removal controls. Optional ERNIE image support
  and local audio processing/voice controls include feature-specific setup.
- Dashboard provides a searchable tool registry with authenticated JSON and
  Markdown contracts. The Shortcut Registry provides application folders and a
  Word starter reference. The tool catalog does not execute model tool calls.
- Desktop, renderer and API share captured build metadata. The public history
  reader is regenerated from the existing public Git history.

The publication snapshot excludes the concurrent Functions sequence work,
Index/Knowledge-link changes and new-chat startup changes. Those remain local
for a later update. Private runtime data, local development history snapshots,
recordings, model weights and generated media are excluded.

See [project status](PROJECT_STATUS.md) for this snapshot's validation and limits.

## 1.0.1-dev - development build identity

Recorded during the September 30, 2026 application-review follow-up. This is a
local development version. It identifies captured source and is not a published
stable release or a certification of all preexisting features.

- R01 coordinates the manifest/lockfile version, desktop software specs,
  renderer identity and backend API metadata. Production builds save a shared
  `build-info.json`, emit that metadata beside the renderer, and add an immutable
  source snapshot to the existing review history.
- R02 adds a shared revision-keyed session/image metadata cache, one combined
  Generate-history inventory request, bounded legacy migration and current lock
  filtering. Its synthetic measurements and preservation checks are recorded
  separately in the [R02 change record](docs/application-review/changes/R02-session-metadata.md).
- R03 (October 1) rejects stale whole-chat replacements, makes rename/compaction
  metadata-only, and coordinates frontend revision/conflict handling. Additive
  replies remain independently durable. See the dated [R03 contract and checks](docs/application-review/changes/R03-session-revisions.md).

The current generated [build record](build-info.json) contains the full source
commit, dirty state at capture, UTC/local capture timestamps, source fingerprint,
snapshot ID, declared/locked/installed JavaScript dependencies and key installed
Python versions. The [local reader](docs/application-review/index.html#versions)
shows the same identity with dependency tables and history comparisons.

Read the [R01 implementation record](docs/application-review/changes/R01-build-identity.md)
for API fields, mismatch behavior, checks and the build workflow.

## Date meanings

- **Commit author/commit date:** recorded Git metadata for the local source
  commit. The current baseline commit is from September 25, 2026.
- **Reported feature date:** a statement such as the September 28 additions in
  `PROJECT_STATUS.md`. It is not proof of original creation time.
- **First observed:** a saved source snapshot shows that a feature's source was
  present by that capture time. Preexisting uncommitted feature creation times
  remain unknown.
- **Build capture:** the precise timestamp associated with a generated build
  identity. It establishes observed source, not deployment or publication.

The existing dated feature ledger remains in
[HISTORY.md](docs/application-review/HISTORY.md). These records identify this
local checkout. Public-repository parity requires a separate review.

## Producing the next reviewed release

1. Coordinate `package.json` and both root version fields in `package-lock.json`.
   Choose a stable version only after the intended release scope is reviewed.
2. Update this release entry and the dated feature/verification ledger. Keep
   reported dates separate from commit and observation dates.
3. Run the relevant isolated checks, then `npm run build`. Vite captures a fresh
   identity before compilation; a failed source capture stops the build.
4. Inspect the generated build record and renderer asset. Fully quit/relaunch
   Electron so the desktop, backend and renderer load the intended build.
5. In Dashboard's software specs, confirm the component build identifiers agree.
   `/version`, OpenAPI `info.version` and `/health` identity headers provide API
   evidence. Review packaging/publication separately when requested.

Build capture requires Git and the project Python environment (or `LAW_PYTHON`).
Running a captured build does not require Git. Generated identity/report assets
do not rewrite Git ancestry or establish remote equivalence.
