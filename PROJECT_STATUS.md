# Project status

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
