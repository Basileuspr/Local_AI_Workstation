# Project status

## Editor and workspace publication review - 2026-10-02

- Prepared the follow-up to public `8c01ac0` in a separate checkout after the
  Document Editor and 3D Viewer & Editor implementation chats completed. See
  [release records](RELEASES.md), [Document Editor](DOCUMENT_EDITOR.md), and
  [3D Viewer & Editor](docs/THREE_D_VIEWER.md) for implemented scope and limits.
- Included the accumulated Functions, Index/Knowledge, startup, local-file,
  media, storage, browser, maintenance and workspace-interface changes. The
  later REVIEW roadmap remains a plan beyond its implemented metadata foundation.
- Combined automated validation passed 1,038 frontend tests (3 skipped),
  1,480 backend tests (2 skipped), 117 Media Manager Python tests and 13 Media
  Manager JavaScript tests. The 35 publication tests also passed after adding
  coverage that bundled asset LICENSE/NOTICE files are retained while private
  directories remain excluded. The existing backup-import confirmation test
  was updated and checks that rejected imports leave existing data intact.
- Installed JavaScript dependencies separately with `npm ci`; `npm audit`
  reported zero known vulnerabilities. The existing Python environment passed
  `pip check`. Tests use disposable data, logs, model paths and media. These
  checks do not establish a fresh Python installation or live model quality.
- Feature-chat QA covered actual DOCX export/reimport, browser editing/recovery,
  and Electron 3D editing, geometry operations, project save/reopen, STL exports,
  measurement and tab switching. Electron QA also opened all 34 workspace Info
  panels. These feature checks are separate from the combined automated suites.
- Real GPU inference, LoRA training, voice quality and physical webcam capture
  were not revalidated for publication. Existing PyPDF2/FastAPI deprecations and
  Vite bundle-size warnings remain. DOCX pagination and advanced Word fidelity
  remain limited; 3D editing/printing limits are documented in its guide.
- Publication uses public Git ancestry and source files only. Personal test
  paths are generalized; private runtime data, recordings, model weights,
  generated media, local reports and private development snapshots are excluded.
  Public history/reader assets are regenerated in this isolated checkout.
- The release is a frozen source capture. Later help-text refinements and other
  development edits made after capture remain local for a subsequent update;
  ongoing chats are not interrupted by publication.

## GitHub source publication review — 2026-10-02

- Reviewed the completed changes against GitHub `main` at `de4dd46`, with the
  update prepared directly on that public history in a separate checkout.
- Published scope includes chat checklists and side panes, session metadata and
  revision protection, Knowledge note/node controls, reference-image generation,
  audio/voice controls, the Dashboard tool registry, Shortcut Registry and shared
  build identity. See [release records](RELEASES.md).
- Concurrent Functions sequences, Index/Knowledge links and new-chat startup
  changes are excluded from this snapshot and remain local for the next update.
- Automated validation: 736 frontend tests, 1,140 backend tests, and 117 Media
  Manager tests passed. Backend data, logs, models and temporary files were
  isolated. A fresh JavaScript dependency installation and production build
  passed; the existing Python environment passed `pip check`. `npm audit`
  reported zero known vulnerabilities.
- Real GPU inference, LoRA training, transcription/voice quality, a fresh Python
  installation, and the running desktop loading this update were not revalidated.
  Existing FastAPI lifecycle deprecation and Vite bundle-size warnings remain.
- The outgoing tree and ancestry are reviewed separately from test results.
  Private runtime data, recordings, model weights, generated media and older
  local development snapshots are excluded; local source and user data remain
  preserved. Public history/reader assets are regenerated in this checkout.

The [September 30 application review](docs/application-review/AUDIT.md) records
fresh checks and distinguishes current findings from the historical entries below.
Use the [local history and comparison reader](docs/application-review/index.html)
to inspect committed changes, uncommitted feature observations and saved versions.

## Build identity follow-up — 2026-09-30

- R01 assigns `1.0.1-dev` and coordinates the generated build identifier across
  desktop software specs, renderer and backend metadata. Production builds
  capture current source/dependency metadata and reject recorded-source drift.
- [Release records](RELEASES.md) and the [R01 change record](docs/application-review/changes/R01-build-identity.md)
  describe capture, component mismatch warnings and the next reviewed-release workflow.
- This is a local development record. Original uncommitted feature creation
  dates and public-repository parity are not established by the version change.

## Feature release review — 2026-09-28

- Character Creator now links biographies, notes, images, videos, audio, faces,
  parts, LoRAs, and Knowledge nodes. Loading a profile into roleplay is explicit.
  Chat previews the active inputs and stores the final request context per reply.
- Added video-to-audio extraction, saved voice phrases, GIF creation under Images,
  ZIP packaging, and isolated browser source inspection in the code viewers.
- Image generation keeps backend-owned tasks, completed batch previews, and
  progress through renderer refreshes, with bounded CPU output overlap.
- Validation: 645 frontend tests, 1,043 backend tests, and 117 Media Manager
  tests passed. The production build and Python dependency consistency check
  passed. The npm audit reports zero known vulnerabilities after updating the
  transitive Undici dependency.
- Desktop checks covered character media playback and Knowledge links, roleplay
  loading/queued settings/reload records, browser isolation/source inspection,
  and real MP4 audio extraction/playback/download in WAV, M4A, FLAC, and MP3.
  Fixtures used disposable data and synthetic media/model responses.
- This review did not rerun GPU inference, voice model quality evaluation, or
  LoRA training. Existing FastAPI lifecycle deprecation and Vite bundle-size
  warnings remain. Publication excludes private data, model weights, generated
  outputs, and the development checkout's older private history.

## PC bridge manual delegation — 2026-09-25

- Dashboard can explicitly start an HTTPS peer listener, pair two PCs in both
  directions, inspect worker models/resources and delegate standalone chat or
  base-model image tasks. The normal desktop API remains loopback-only.
- Persistent job IDs and records support reconnects, duplicate-delivery
  protection, cancellation and deliberate recovery after worker restarts.
  Returned results can be saved as separate local chats without overwriting edits.
- Jobs execute through existing local routes, GPU coordination and queueing.
  The bridge starts off on every app launch and blocks maintenance while listening.
- Real HTTPS integration tests and local-route adapter tests cover the protocol;
  inference is mocked. Headless UI checks cover pairing, discovery, submission
  and result display. Actual two-PC network and inference performance remain to
  be tested. See [PC bridge](PC_BRIDGE.md) for setup and the first test.
- Automatic routing, batch splitting, distributed model execution, training
  delegation and synchronization of existing workspaces are future work.

## Windows compatibility update — 2026-09-25

- Added automatic live capability reporting, memory-aware chat defaults,
  model-list refresh after service/install changes, feature-specific controls,
  CPU fallback for failed face GPU initialization and low-VRAM SDXL offload.
  These policies preserve explicit selections and do not download models.

- Added a core Windows setup path, optional knowledge/face dependencies,
  feature-local native-library failures, startup guidance, renderer recovery,
  software rendering, and image-memory-failure cleanup.
- A separate checkout completed the setup script under Windows PowerShell 5.1,
  including a fresh Python environment, dependency consistency check and build.
  Its backend served saved-data APIs and knowledge listings without PyTorch.
- A second core-only environment started and served sessions, images, face/LoRA
  listings and text parsing with Torch, Chroma, ONNX and text splitters absent;
  knowledge search returned a deliberate 503 with setup guidance.
- Frontend tests (443), the full backend suite, targeted capability/memory-failure tests,
  and the production build passed. Data and build outputs were isolated.
- This does not establish operation on every Windows version or laptop, live
  Electron recovery behavior, or real inference/training performance. See
  [Windows compatibility](WINDOWS_COMPATIBILITY.md).

## Earlier publication validation

Verified 2026-09-23 on the local `baseline/v1.0.0-portable` checkout. The
known limitations below were last reviewed on 2026-09-19.

The application is a working local desktop development checkout. It is not a
packaged release, and the checks below do not establish production readiness.

## Verification

- 735 backend tests passed with isolated data, log, model and test directories.
- 410 frontend tests passed.
- The Vite production build passed.
- Existing FastAPI lifecycle deprecation warnings and a Vite bundle-size
  warning remain.

These checks used an existing dependency installation. A fresh dependency
installation, real GPU inference and LoRA training were not validated by this
publication check.

## Implemented areas

- Electron startup, authenticated loopback API access and local settings.
- Streaming Ollama chat, attachments, session storage and export routes.
- Document ingestion, knowledge-base retrieval and durable memory.
- Single-page public HTTPS ingestion with network destination checks.
- Image generation, prompt controls, galleries, queues and image workflows.
- LoRA dataset preparation, training orchestration and adapter controls.
- Face detection, crop curation, similarity grouping and character profiles.
- Persistent scene state and reviewed transitions between generated frames.
- Image collections, media manager, image editor and character parts.
- Knowledge vault and knowledge graph.
- Dashboard drive space, system stats, CPU assistance, maintenance and reset.

## Known limitations

- Locked images can remain accessible through face-derived copies; the private
  image boundary needs to cover those derived resources.
- Replacing a knowledge-base document can remove the previous index before a
  replacement embedding succeeds.
- Desktop navigation restrictions can block chat Markdown and face ZIP
  downloads even when their API routes succeed.
- Face Studio selection and reference state do not fully survive reload.
- The LLM action planner / iterative scene director is not implemented.
- ControlNet, an embedding-conditioned face adapter and general multi-reference
  conditioning are not implemented.
- A previously recorded real SDXL smoke test ended in a native runtime crash
  before producing a frame. End-to-end continuity quality remains unverified.
- Portable packaging and a clean-machine installation test remain outstanding.

Feature-specific documentation describes additional constraints. Older sections
of `ARCHITECTURE.md` and implementation reports are historical snapshots; source
and current tests take precedence where they differ.

## Session persistence follow-up - 2026-10-01

R03 adds expected-revision checks to whole-history replacement, metadata-only rename/settings and compaction, and coordinated frontend conflict handling. Appended replies are saved independently of summary conflicts. The dated contract and preservation evidence are in [R03](docs/application-review/changes/R03-session-revisions.md). This is development source; rebuild and fully relaunch to load it.
