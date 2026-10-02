# Local AI Workstation â€” application review and history

Reviewed 2026-09-30 (America/Denver).

Inspection of the current local source, dependency metadata, Git history, targeted performance and recovery paths, automated suites, and a scratch production build. This is a baseline audit, not an exhaustive review of every implementation or a packaged release certification.

R01, R02 and R03 are implemented: captured build identity, shared session/image metadata, and revision-checked history replacement with coordinated frontend conflict handling. Completed findings include dated changes and validation; other findings remain proposed unless marked implemented.

[Open the local reader](index.html) · [Read history](HISTORY.md) · [Workflow](README.md)

## Validation at this review

- **Frontend suite** — 645 tests passed across 77 files (Automated).
  Command: `npm run test`
- **Backend suite** — 1,043 passed; four FastAPI lifecycle deprecation warnings (Automated / isolated data).
  Command: `venv\Scripts\python.exe -B -m pytest --basetemp <scratch tests>; LAW_DATA_DIR, LAW_LOG_DIR and LAW_MODELS_DIR point to scratch directories`
- **Media Manager suite** — 104 Python and 13 Node tests passed (117 total) (Automated).
  Command: `npm run test:media`
- **Production build** — Passed: 245 modules; main JS 909.87 kB (278.33 kB gzip), CSS 181.46 kB, separate emoji chunk 431.17 kB. Main bundle exceeded the warning threshold. (Measured artifact size).
  Command: `node_modules\.bin\vite.cmd build --config vite.config.mjs --outDir <scratch build>`
- **Python dependency consistency** — No broken requirements found (Installed metadata).
  Command: `venv\Scripts\python.exe -m pip check`
- **npm dependency advisory audit** — Zero reported known vulnerabilities at review time; not a complete security audit (Registry advisory check).
  Command: `npm audit --json`
- **Current local listeners and health** — Backend :8000 and Ollama :11434 were bound to 127.0.0.1; backend /health returned ok; Ollama reported 0.34.3 (Read-only runtime observation).
  Command: `Get-NetTCPConnection; GET /health; GET Ollama /api/version`
- **ONNX execution providers** — AzureExecutionProvider and CPUExecutionProvider; CUDAExecutionProvider absent (Runtime provider discovery).
  Command: `onnxruntime.get_available_providers()`
- **History reader and capture workflow** — Browser search, priority filters, history search, unchanged/changed source comparisons passed through loopback preview. Capture helper checks passed for hashes, exclusions, add/change/remove, two-observation rendering, escaping, record preservation and source references. Browser policy blocks file URLs; direct offline opening was not browser-verified. (Interactive reader and isolated helper validation).
  Command: `Browser interactions; synthetic comparison/render checks in temporary output folder`
- **R02 implementation (2026-09-30T23:17:55.880201-06:00)** — Verified 2026-09-30T23:24:38.186385-06:00. Full isolated backend suite: 1,062 passed (four existing lifecycle warnings), including warm-cache rename, append, trash/restore, hide/restore, permanent image removal, shared-blob retention, external replacement/removal/repair, deterministic legacy URLs, migration bounds, damaged-vault rejection and real PIN lock/unlock/restore. Frontend: 669 tests across 79 files passed. Scratch production build passed. Synthetic cold listings read each chat once; warm listings read zero session JSON bytes. Exact baseline/current metadata equality was asserted. Unverifiable legacy source metadata also fails closed while locks exist, with original JSON preserved. The reader displays the completed finding and measured table, and comparison with the preceding source observation was checked. (Automated / isolated data and synthetic measurements).
  Command: `npm run test; isolated pytest tests/backend; scratch Vite production build; venv\Scripts\python.exe -B scripts/benchmark-session-metadata.py --output docs/application-review/benchmarks/session-metadata.json`
- **R01 build identity (2026-09-30T23:51:06.121761-06:00)** — 1,077 backend tests and 681 frontend tests across 82 files passed. Targeted capture/desktop/backend tests cover matching portable records without Git in the source folder, dirty content changing the identifier with the same version/commit/time, modified or missing recorded files, version mismatch, absent/corrupt metadata, API/OpenAPI/health identity and software inventory. Scratch build passed and emitted build-info.json. Final artifact/API/reader agreement is checked after the completed capture. Existing lifecycle and bundle-size warnings remain. (Automated / isolated data, cross-language metadata and scratch build).
  Command: `Isolated pytest tests/backend; npm run test; Vite scratch production build with automatic --build source capture; fresh-process API and desktop-loader comparison`
- **R03 session revisions (2026-10-01T00:10:04-06:00)** — 1,089 backend tests and 688 frontend tests across 84 files passed; final metadata guard rechecked with 33 backend and 4 frontend checks. Synthetic competing clients and delayed navigation verified; scratch build and updated reader checked. (Automated / isolated data / reader).
  Command: `Isolated pytest; npm run test; scratch npm run build`

These results belong to the dated audit, not to every later snapshot. Future captures do not rerun tests.

## Validation limits

- Real SDXL inference, output quality, GPU memory use, sustained throughput, and model-switch latency
- Real LoRA training, forced-crash recovery, or disk-exhaustion recovery
- Voice-cloning quality and real transcription accuracy
- Fresh installation, another PC, every Windows build, or two-PC bridge inference
- A newly restarted Electron renderer running the scratch build
- Python vulnerability scanning (pip check checks dependency consistency only)
- R02 actual user-library latency, flushed-disk-cache I/O, HTTP/renderer end-to-end latency, or a restarted desktop running the new source

## Findings and change status

P1 = prioritize correctness, recovery or growing-library impact. P2 = measure or plan next. Findings remain proposed unless explicitly marked implemented with dated verification.

### R01 · P1 · The release version cannot identify the current feature set

**Evidence:** Coordinated development version and shared captured build identity implemented; automated API/desktop parity, source-drift and scratch-build checks passed.

package.json is still 1.0.0, while the recorded local baseline is from September 25 and 254 worktree entries were already changed/untracked before this audit. FastAPI is constructed without an explicit application version. PROJECT_STATUS describes September 28 additions. Git cannot establish the original creation times of those uncommitted additions.

**Proposed next step:** Use the saved source snapshots and dated feature ledger now. For the next reviewed release, establish a coordinated version/build identifier for package.json, desktop software specs and the backend, plus a readable release entry. Keep commit date, reported feature date and first-observed date distinct.

**Acceptance check:** A reader can identify app version, source commit, dirty state, exact capture time and dependency versions from one record; the same build identifier appears in desktop and API metadata.

**Preserve:** Do not rewrite private Git ancestry or infer that the public repository matches this checkout.

Source: [package.json](../../package.json), [package-lock.json](../../package-lock.json), [scripts/capture-app-review.py](../../scripts/capture-app-review.py), [scripts/prepare-build.cjs](../../scripts/prepare-build.cjs), [vite.config.mjs](../../vite.config.mjs), [electron/buildInfo.js](../../electron/buildInfo.js), [electron/main.js](../../electron/main.js), [backend/services/build_info.py](../../backend/services/build_info.py), [backend/main.py](../../backend/main.py), [backend/services/software_specs.py](../../backend/services/software_specs.py), [backend/routes/system_stats.py](../../backend/routes/system_stats.py), [src/buildIdentity.js](../../src/buildIdentity.js), [src/softwareSpecs.js](../../src/softwareSpecs.js), [src/components/SoftwareSpecs.jsx](../../src/components/SoftwareSpecs.jsx), [RELEASES.md](../../RELEASES.md), [tests/backend/test_build_identity.py](../../tests/backend/test_build_identity.py), [tests/frontend/buildIdentity.test.js](../../tests/frontend/buildIdentity.test.js).

**Status:** Implemented · 2026-09-30T23:51:06.121761-06:00

**Completed change:** Assigned 1.0.1-dev in the package manifest and root lockfile records. Production Vite builds capture a fresh shared build-info.json and immutable source snapshot before compilation, embed the identifier in the renderer, emit portable metadata, and stop if the captured source or identity changes before bundle emission. Desktop IPC and backend process metadata read the same record once at startup. FastAPI has an explicit package version; /version and /health identity headers expose API metadata. Software specs include commit, dirty state, exact capture time and component identifiers, with stale-source/mismatched-component notices. Added a readable local release entry and preserved the existing dated feature ledger.

**Verification result:** 1,077 backend tests and 681 frontend tests across 82 files passed. Targeted capture/desktop/backend tests cover matching portable records without Git in the source folder, dirty content changing the identifier with the same version/commit/time, modified or missing recorded files, version mismatch, absent/corrupt metadata, API/OpenAPI/health identity and software inventory. Scratch build passed and emitted build-info.json. Final artifact/API/reader agreement is checked after the completed capture. Existing lifecycle and bundle-size warnings remain.

[Before/after measurements and preservation checks](changes/R01-build-identity.md)

### R02 · P1 · Session lists and image lists parse the whole chat library

**Evidence:** Implemented and verified with isolated mutation/privacy tests and 100/1,000/5,000-chat synthetic benchmarks; actual user-library latency not measured.

list_sessions reads every session JSON to return small summaries; list_session_images reads every session and walks its messages. Generate history reconciliation can request visible and hidden lists together, and other consumers refresh the same library. Cost grows with total retained conversation content. Some image-list reads also save missing stable IDs.

**Proposed next step:** Create a rebuildable session/image metadata index or a revision-keyed cache, invalidate it on all relevant saves/removals/locks/restores, and serve visible/hidden metadata from one shared inventory. Move any legacy migration work into an explicit bounded path. Keep session JSON authoritative.

**Acceptance check:** Measure warm/cold list latency and bytes read for 100, 1,000 and 5,000 synthetic chats; verify rename, restore, append, lock/unlock and image removal invalidate the index without losing data.

**Preserve:** A cache must never expose locked images or discard recoverable chat/image references.

Source: [backend/services/session_store.py](../../backend/services/session_store.py), [backend/routes/sessions.py](../../backend/routes/sessions.py), [src/api.js](../../src/api.js), [src/ImageGenerationContext.jsx](../../src/ImageGenerationContext.jsx), [tests/backend/test_session_metadata.py](../../tests/backend/test_session_metadata.py), [tests/backend/test_image_collections.py](../../tests/backend/test_image_collections.py), [tests/frontend/sessionImageInventory.test.js](../../tests/frontend/sessionImageInventory.test.js), [scripts/benchmark-session-metadata.py](../../scripts/benchmark-session-metadata.py).

**Status:** Implemented · 2026-09-30T23:17:55.880201-06:00

**Completed change:** Added a process-local, rebuildable metadata cache keyed by session file revision. Summaries and visible/hidden image metadata share that inventory. Atomic saves, trash/removal and restores refresh affected entries; revision checks detect external changes. Vault policy is checked after every inventory read, without caching public-access decisions. Generate history uses one combined request. Listings never save legacy IDs or migrate payloads; selected-chat migration is limited to 25 IDs and opening a chat remains a one-chat migration with a preserved original backup. Session JSON remains authoritative. Unknown legacy content identities are suppressed while privacy locks exist, without removing their JSON references.

**Verification result:** Verified 2026-09-30T23:24:38.186385-06:00. Full isolated backend suite: 1,062 passed (four existing lifecycle warnings), including warm-cache rename, append, trash/restore, hide/restore, permanent image removal, shared-blob retention, external replacement/removal/repair, deterministic legacy URLs, migration bounds, damaged-vault rejection and real PIN lock/unlock/restore. Frontend: 669 tests across 79 files passed. Scratch production build passed. Synthetic cold listings read each chat once; warm listings read zero session JSON bytes. Exact baseline/current metadata equality was asserted. Unverifiable legacy source metadata also fails closed while locks exist, with original JSON preserved. The reader displays the completed finding and measured table, and comparison with the preceding source observation was checked.

[Before/after measurements and preservation checks](changes/R02-session-metadata.md)

### R03 · P1 · Whole-session replacement still accepts stale histories

**Evidence:** Revision contract implemented; disposable competing HTTP clients reproduced and rejected stale replacement without modifying newer JSON.

update_session replaces session['messages'] with the incoming list, with no expected revision. Serialized writes and atomic replacement prevent partial files but do not prevent an older full-history save from overwriting a newer one. The chat completion path already uses appendSessionMessages, which reduces exposure there.

**Proposed next step:** Add a revision/expected-revision contract and conflict response for remaining replacement paths; keep append-by-stable-ID for additive operations and metadata-only updates for rename/settings.

**Acceptance check:** Two synthetic clients save from the same starting revision: the stale replacement is rejected, both appended messages survive, and compaction/rename/navigation preserve newer content.

**Preserve:** Changing this API requires coordinated frontend handling; do not silently merge summaries or rewrite live chat history.

Source: [backend/services/session_store.py](../../backend/services/session_store.py), [backend/routes/sessions.py](../../backend/routes/sessions.py), [src/api.js](../../src/api.js), [src/components/InputBar.jsx](../../src/components/InputBar.jsx), [src/components/Header.jsx](../../src/components/Header.jsx), [backend/routes/bridge.py](../../backend/routes/bridge.py), [src/App.jsx](../../src/App.jsx), [src/useStore.jsx](../../src/useStore.jsx), [src/sessionPersistence.js](../../src/sessionPersistence.js), [src/webAccess.js](../../src/webAccess.js), [src/useChatUploads.js](../../src/useChatUploads.js), [src/ImageGenerationContext.jsx](../../src/ImageGenerationContext.jsx), [src/workspaceContext.js](../../src/workspaceContext.js), [tests/backend/test_session_revisions.py](../../tests/backend/test_session_revisions.py), [tests/frontend/sessionRevisions.test.jsx](../../tests/frontend/sessionRevisions.test.jsx).

**Status:** Implemented · 2026-10-01T00:10:04-06:00

**Completed change:** Session writes issue fresh opaque revisions. Whole-history replacement requires the loaded expected_revision (409 conflict / 428 required). Stable-ID append preserves other messages; existing-ID edits and summaries require matching revisions. Metadata-only rename/settings preserve messages; manual and automatic compaction save summaries against their source revision, independently from replies. Frontend surfaces conflicts without merging/retrying and guards delayed metadata across navigation. Web and Bridge additive paths use append; restored sessions invalidate old revisions.

**Verification result:** 1,089 backend tests passed and 688 frontend tests across 84 files passed. Two synthetic HTTP clients shared a revision: the stale replacement returned 409 with unchanged JSON; both concurrent appends survived. Checks include rename, summary conflicts, compaction preserving messages/title, delayed navigation/revision responses, restore/image reference preservation, legacy identity and missing-revision rejection. Final metadata guard rechecked with 33 backend and 4 frontend checks. Scratch build and reader checked after the completed record. Live history and running desktop were preserved.

[Before/after measurements and preservation checks](changes/R03-session-revisions.md)

### R04 · P2 · All major workspaces join the initial application bundle

**Evidence:** Measured bundle size and confirmed eager imports.

The scratch production build produced a 909.87 kB main JS chunk. App.jsx statically imports the major workspaces and mounts their panes immediately, hiding inactive ones with CSS. This deliberately preserves drafts, selection and capture behavior; startup time was not measured.

**Proposed next step:** Load heavy workspaces on first visit, then retain their state/mount after activation. Define background capture behavior for never-opened tabs. Split shared vendor code only where the measured startup path benefits.

**Acceptance check:** Compare cold renderer readiness, memory and first-open latency; preserve chat drafts, pending attachments, generation observers, scroll positions, browser isolation and all-tab captures.

**Preserve:** Unmounting inactive panes blindly would regress established state preservation.

Source: [src/App.jsx](../../src/App.jsx), [src/components/AppLayout.jsx](../../src/components/AppLayout.jsx), [vite.config.mjs](../../vite.config.mjs), [electron/tabCapture.js](../../electron/tabCapture.js).

Official guidance: [https://vite.dev/guide/build.html](https://vite.dev/guide/build.html).

### R05 · P2 · Shared state updates notify broad groups of mounted consumers

**Evidence:** Confirmed React architecture; profiler impact not measured.

useStore exposes one StoreContext state object, with separate dispatch/refs contexts. Every changed state object notifies state consumers, including mounted hidden panes. Queue and image providers also publish fresh objects during polling. This is not a claim that streamed tokens dispatch the whole React store: their live text path writes directly to the DOM.

**Proposed next step:** Profile first; split frequently changing domains or introduce stable selectors, and memoize expensive leaf views where justified. Retain the existing dispatch/refs separation.

**Acceptance check:** Record React commits and scripting time during queue polling, tab switches and long chats before/after; confirm hidden panes receive required state transitions.

**Preserve:** Memoization must not hide updated selections, privacy state or completion results.

Source: [src/useStore.jsx](../../src/useStore.jsx), [src/App.jsx](../../src/App.jsx), [src/components/PromptQueue.jsx](../../src/components/PromptQueue.jsx), [src/ImageGenerationContext.jsx](../../src/ImageGenerationContext.jsx).

Official guidance: [https://react.dev/reference/react/useContext](https://react.dev/reference/react/useContext).

### R06 · P2 · Streaming text performs DOM and scroll work for every token

**Evidence:** Confirmed implementation; long-chat frame timing not measured.

For each token InputBar locates the message, replaces textContent, recreates the cursor and reads scrollHeight before scrolling. MessageList also maps the retained conversation without windowing. Long responses and large transcripts are candidates for excess layout/render work.

**Proposed next step:** Batch live text updates once per animation frame, honor the user's scroll position, and profile message-row memoization or windowing for large transcripts.

**Acceptance check:** Compare dropped frames, scripting/layout time and Stop responsiveness on a synthetic long response and 1,000-message chat; ensure the final saved content exactly matches the stream.

**Preserve:** Preserve reader cleanup, completed Markdown rendering, image viewers and navigation targeting.

Source: [src/components/InputBar.jsx](../../src/components/InputBar.jsx), [src/components/MessageList.jsx](../../src/components/MessageList.jsx).

### R07 · P2 · Several independent polling paths remain active across tabs

**Evidence:** Confirmed timers; total idle cost not measured.

App status polls every five seconds; Dashboard continues its non-overlapping five-second loop while hidden; queue polls after about two seconds idle or 750 ms active; image tasks poll after one second. Hardware sampling already caches readings for two seconds and expensive hardware discovery for fifteen seconds. Image task and queue histories already prune finished records to about 100; they are not unbounded.

**Proposed next step:** Share observers or use adaptive idle/backoff intervals and coalesced invalidation. Consider lightweight active-task updates versus full task history responses. Preserve backend-owned tasks and completed previews.

**Acceptance check:** Measure idle request count, response bytes and CPU over five minutes, then repeat during generation; completion/Stop feedback remains prompt and refresh still reconnects.

**Preserve:** Hiding a pane must not cancel its backend work or erase its draft/history.

Source: [src/App.jsx](../../src/App.jsx), [src/components/Dashboard.jsx](../../src/components/Dashboard.jsx), [src/components/PromptQueue.jsx](../../src/components/PromptQueue.jsx), [src/ImageGenerationContext.jsx](../../src/ImageGenerationContext.jsx), [backend/services/system_stats.py](../../backend/services/system_stats.py), [backend/services/image_tasks.py](../../backend/services/image_tasks.py).

### R08 · P2 · Deprecated FastAPI lifecycle hooks remain

**Evidence:** Four warnings reproduced in the full backend suite.

Image workflow and character-parts routes still register startup/shutdown through router.on_event. They currently pass tests, but the installed runtime warns to use lifespan handlers.

**Proposed next step:** Move lifecycle ownership into a coordinated application lifespan, preserving interrupted-run handling, runner initialization and awaited shutdown.

**Acceptance check:** Run startup/shutdown integration tests and the full backend suite with these warnings treated as errors; confirm workers stop and reservations release safely.

**Preserve:** Do not drop route startup recovery or finish shutdown before workers exit.

Source: [backend/routes/image_workflows.py](../../backend/routes/image_workflows.py), [backend/routes/character_parts.py](../../backend/routes/character_parts.py), [backend/main.py](../../backend/main.py).

Official guidance: [https://fastapi.tiangolo.com/advanced/events/](https://fastapi.tiangolo.com/advanced/events/).

### R09 · P2 · The Node readiness check is looser than dependency engine requirements

**Evidence:** Confirmed setup logic and installed package engines.

setup-windows.ps1 accepts any Node major >=22. Installed Electron 44.4.5 requires >=22.12.0, and Vitest 4.1.11 supports ^20, ^22 or >=24, so the setup check also admits Node 22.0 and Node 23 without establishing their suitability. The current Node 22.18.0 satisfies the inspected engines.

**Proposed next step:** Check a supported Node release range and minimum patch in setup and documentation, and enforce the same requirement in package.json. Use lock-preserving installation for reproducibility.

**Acceptance check:** Readiness tests accept the working 22.18 baseline and a deliberately supported newer LTS; reject below-minimum 22.x and unsupported odd majors with clear guidance.

**Preserve:** Do not upgrade dependencies just to remove warnings; validate a fresh environment separately.

Source: [scripts/setup-windows.ps1](../../scripts/setup-windows.ps1), [package.json](../../package.json), [package-lock.json](../../package-lock.json), [README.md](../../README.md).

### R10 · P2 · Audio setup is outside the recorded full Python lock

**Evidence:** Confirmed requirements files and installed metadata.

requirements-audio.txt pins faster-whisper and sherpa-onnx, but has no constraint on the full lock and does not pin CTranslate2. These three packages are absent from requirements.lock.txt. The current environment contains faster-whisper 1.2.1, sherpa-onnx 1.13.8 and CTranslate2 4.8.2, and pip check passes. Compatibility of native CUDA libraries is not established by pip check.

**Proposed next step:** Record separate validated optional-runtime constraints and an installation matrix for core, SDXL, faces, transcription and isolated voice runtimes. Test CPU-first fallback and specific CUDA/cuDNN combinations before offering GPU acceleration.

**Acceptance check:** Fresh installs reproduce the selected versions; native imports/provider initialization pass; CPU fallback is usable when CUDA dependencies are absent.

**Preserve:** Do not replace the CPU ONNX package with a GPU package in the working environment without testing its provider/library combination.

Source: [requirements-audio.txt](../../requirements-audio.txt), [requirements.lock.txt](../../requirements.lock.txt), [requirements-faces.txt](../../requirements-faces.txt), [backend/services/audio_acceleration.py](../../backend/services/audio_acceleration.py), [backend/services/faces/insight_onnx.py](../../backend/services/faces/insight_onnx.py), [AUDIO.md](../../AUDIO.md).

Official guidance: [https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html).

### R11 · P1 · Interrupted LoRA states need a complete restart reconciliation contract

**Evidence:** Confirmed source gap; forced-crash behavior unverified.

LoRA project loading reconciles queued jobs after a queue restart, but the inspected loader does not reconcile starting/running/cancelling states. The manager tracks child identity in memory and cancel requires its active child. Its normal watcher performs cleanup, but that watcher cannot be assumed to run after backend termination. Electron reports unexpected backend exit; the inspected close handler does not automatically restart it.

**Proposed next step:** Reconcile all active training states against verified process/run ownership on startup, preserve completed adapters and source datasets, and expose deliberate recovery. Do not mark a still-running external worker interrupted without verifying ownership.

**Acceptance check:** Use disposable projects and synthetic worker processes to cover backend restart, orphaned worker, stale status, monitor failure and disk-full persistence failure. Then separately validate a real training run when authorized.

**Preserve:** Incorrect recovery could release GPU ownership while a worker remains alive or damage training data.

Source: [backend/services/lora_store.py](../../backend/services/lora_store.py), [backend/services/lora_training.py](../../backend/services/lora_training.py), [electron/main.js](../../electron/main.js).

## Already implemented

- Knowledge ingestion embeds bounded batches of 16 through one reused HTTP connection; replacement embeddings finish before the previous document is modified.
- SDXL uses native SDPA when available; attention slicing is a fallback. fp16, VAE slicing/tiling, adaptive CPU offload and shared workflow pipelines remain.
- GPU admission is serialized; CPU lanes and bounded output saving overlap are separate. This is a stability boundary, not an invitation to run unrestricted simultaneous GPU jobs.
- Image tasks are owned by the backend and survive renderer refresh; task status itself does not survive backend restart. Finished image/queue histories are capped.
- Ollama keep-alive is configurable; model handoff parks/releases allocations rather than assuming every provider can remain GPU resident.
- Optional dependencies are feature-local; face inference has CPU fallback. Only CPU/Azure ONNX providers were available in this environment.
- Session image bytes are content-addressed; chat uses stable IDs and append operations for completion. Hidden panes deliberately retain drafts and state.
- The current Ollama listener is loopback-only; the older observation of an all-interface listener is not current evidence. The PC bridge is an explicit separate feature.

## Suggested order

1. R01, R02 and R03 are implemented. Use their dated records and shared build identity to prepare the next reviewed stable release.
2. Address training recovery with disposable restart tests; session revision conflicts now have coordinated handling.
3. R02 is implemented and measured; next measure startup loading, renderer updates and idle polling before optimizing those paths.
4. Coordinate lifecycle migration, stricter setup readiness and optional-runtime constraints.
5. Benchmark cold/warm model loads, queue wait, denoising, decode/save and first-token latency separately when real-model testing is requested.

## Metrics for before/after comparisons

- Cold and warm app readiness (seconds) and renderer memory
- Session/gallery list latency p50/p95 and bytes read as library size grows
- Idle requests/minute, response bytes and CPU while another tab is open
- Long-chat frame time, Stop response and exact final saved text
- Model-load time, queue-wait time, inference time, output-save time and peak VRAM separately
- Crash/restart recovery success, dependency/provider readiness and fresh-install success
