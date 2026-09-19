# Roadmap segments 4â€“6 implementation

Implementation reference for desktop security, persistent scene state and
reviewed frame continuity. Normal Generate remains available separately.

## Segment 4: desktop and backend boundary

| Finding | Severity / effect | Resolution |
| --- | --- | --- |
| Older built renderer sent no session token | High availability impact: every privileged API returned 403 | Rebuilt `dist`; the sandboxed preload obtains the current connection from a main-frame-only IPC handler. The desktop credential is no longer carried in its document URL. |
| Custom app scheme compared with Node URL.origin | High availability impact: valid desktop IPC rejected because Node reports `null` for custom schemes | Compare parsed protocol, hostname, port and absence of credentials; retain strict development-origin matching. |
| Navigation prefix checks accepted lookalike / credential URLs | High trust-boundary risk | Parsed URL checks; external HTTP(S) links open in the OS browser, child windows and webviews are denied. Credential-bearing API URLs are never passed to the OS browser. |
| Startup reused any service answering /health | High availability and ownership risk | Select a free port and launch an owned backend; verify a per-launch, non-secret health marker before using it. A process-lifetime data-directory lock prevents two new backends writing the same app data. |
| Changing file origin hid existing local preferences | Medium migration risk | A hidden, script-disabled window reads only known settings, roleplay and phrase keys in an isolated world. Merge with newer app-origin values taking precedence and keep all original values. Successful migration is marked for idempotence; failures preserve data and retry. |
| Query credentials could enter logs or cached responses | Medium disclosure risk | Redact session query values in Python and Electron log handlers; protected API responses use no-store, no-referrer and nosniff. Packaged pages also receive CSP and referrer headers. |
| Detached console pipe raised EPIPE in main process | Medium availability impact | Console output failure no longer crashes the window; file logging continues. |

The existing global `SessionGuard` enforces loopback Host, allowed application
Origin when supplied, and a high-entropy per-launch token for every privileged
HTTP route. Chats, images, files, model/runtime controls, hardware, settings,
jobs, private image operations, and scene APIs all pass through that guard.
`/health` is public liveness; the renderer checks authenticated `/runtime/status`.
Default CORS names `app://local` and the local development origins; generic
`null` and arbitrary website origins are refused. Origin and CORS are defense
in depth; the credential is required even without an Origin header.

Model context uses configured `LAW_NUM_CTX` (default 16384, minimum 2048),
clamped against model metadata for frontend budgeting. Chat and compaction
requests explicitly send `num_ctx`. This work retains the context corrections
already present in the reviewed checkout. Local SDXL pipeline/tokenizer loads,
workflow reuse, and LoRA local model loads use local-only loading. Explicit web
ingestion and face-model installation remain network features; offline
generation does not silently download a missing checkpoint.

The source/build discrepancy was functional, so the renderer was rebuilt.
`ARCHITECTURE.md` identifies its historical sections; its blanket no-network
claim and the old workflow-planning claim in `INTERNET_ACCESS_PROPOSAL.md` were
corrected. No new runtime dependency was required.

Remaining boundary limits: a compromised local OS account or trusted renderer
can access the session; this is not an OS sandbox against local malware. Media
URLs still need query credentials, so only local protected endpoints receive
them. Development browser use requires a deliberately supplied matching token.
An orphaned backend holding the data lock must be closed before a new launch;
it is never adopted with a new secret. Pre-existing external backends that do
not implement this lock should not share the same data directory.

## Segment 5: persistent visible state

Workflow schema version 1 gains backward-compatible `mode` (default `stages`)
and optional `scene`. Old workflows remain stage workflows. Scene state has its
own `schema_version: 1`, bounded text, strict unknown-field rejection, unique
object IDs, and no arbitrary file paths.

| State group | Fields |
| --- | --- |
| Character | profile ID, name, appearance, clothing, accessories |
| Environment | location, background |
| Camera | framing, angle, focal length, orientation, position |
| Lighting | source, direction, intensity, style |
| Body | stance, each arm and hand, wrist rotation, gaze, orientation |
| Objects (up to 24) | stable ID, name, appearance, position, orientation, contact, progression |
| Frame description | current visible action, visual style |

The scene also stores source asset, parent-frame reference, owned identity
references, chosen model, dimensions and denoise. Workflow prompt settings hold
negative prompt, steps, guidance and seed. Storage remains atomic,
revision-checked `data/image_workflows/<id>/workflow.json`; images are copied into
the workflow's owned hash-addressed assets. No second scene database is added.

The UI edits labeled fields and autosaves; an in-flight save cannot erase newer
keystrokes. A failed or conflicting save reports an error and preserves the
saved version. Tabs remain mounted. Reopening a saved scene restores it from
disk; localStorage remembers only the selected mode/scene ID. Advanced users can
inspect or replace state JSON with backend validation.

`PATCH /image-workflows/{id}/scene` merges only supplied fields. Object patches
match stable IDs; omission preserves peers and explicit `remove_objects` removes
objects. A future planner can submit the same patches. Today the user edits
the desired visible result; free-form instruction interpretation is not part of
segment 5. The deterministic constructor emits all non-empty visible details,
excludes internal identity IDs, and rejects oversized descriptions. The backend
recompiles the authoritative prompt before saving or running.

Example: start with right hand = gripping screwdriver, driver tip = seated in
screw, screw progression = 50% inserted. Patch only wrist rotation = further
clockwise and screw progression = 70% inserted. Clothing, camera, lighting,
environment, grip and driver contact remain unchanged and stay in the prompt.

## Segment 6: reviewed frame continuity

A scene without a source compiles to one txt2img stage. After **Use as next
source**, the chosen output is verified and copied into owned assets; the scene
compiles to img2img. Uploaded starting images are also supported. Identity
references are carried as immutable owned crops and profile metadata; selecting
a profile does not imply embedding-conditioned SDXL support.

Each attempt gets its own immutable `jobs/<id>/job.json` input snapshot and
`run.json` with resolved seed, result hashes, model parameters and provider
metadata. Frames retain parent workflow/job/output IDs, full state, prompt,
dimensions, steps, guidance, seed and denoise. Candidate frames never become the
next source automatically. Restore/branch operations leave old outputs intact;
branches own their image bytes. Explicit deletion of a parent workflow removes
its associations while preserving independently owned image copies.

The provider uses the existing image manager and GPU lease. One loaded SDXL
checkpoint supplies txt2img and `from_pipe` img2img/inpaint views sharing the
UNet, VAE and text encoders. Exactly one offload hook chain is active at a time.
Weights stay offloaded between frames and release on reset/model change or
handoff to chat/training. Workflows explicitly clear any normal-Generate LoRA;
the user's normal Generate settings are unchanged. No implicit model fallback
or weight download occurs.

Stop signals the real native worker and waits for it before releasing the GPU
lease. Completed stage outputs remain reviewable/exportable after a later
failure, cancellation or restart; incomplete files are never promoted. Restart
marks active attempts interrupted. Nothing resumes inference automatically.

New scene endpoints, all session protected: GET `/{id}/scene/frames`, PATCH
`/{id}/scene`, POST `/{id}/scene/frame` (`continue`, `restore`, `branch`), and POST
`/{id}/scene/identity`. Existing execute, poll, stop, assets, export, gallery and
revision checks are reused.

Continuity limitations: img2img cannot guarantee identity, precise hand/pose
geometry, object progression or frame-to-frame consistency. High denoise can
redesign a scene. There is no IP-Adapter, ControlNet integration, automatic
recognition acceptance, interpolation, animation export, or segment 7 planner.

## Changed implementation surfaces and validation

- Desktop: `electron/main.js`, `preload.js`, `security.js`,
  `preferenceMigration.js`, `logger.js`.
- Boundary/runtime: `backend/main.py`, `services/session_guard.py`,
  `process_lock.py`, `app_logging.py`, `image_generation.py`.
- Scenes/workflows: `services/image_workflows/{scene_state,scenes,contracts,
  store,planning,providers,runner,adapters,exports,deletion}.py`, workflow routes.
- Renderer: `config.js`, `api.js`, `faceApi.js` (missing recompute export repair),
  `sceneState.js`, workflow API/helpers, `SceneStudio.jsx`, `ImageWorkflows.jsx`,
  `WorkflowRunPanel.jsx`, `WorkflowExportControls.jsx`, `styles.css`, built `dist`.
- Tests cover origin spoofing, migration merges, private response headers,
  state patch preservation, invalid state, revision conflicts, saved snapshots,
  frame selection/regeneration/branch ownership, identity-copy persistence,
  shared components/offload switching, cancellation, and partial recovery.
- Electron QA scripts in `scripts/qa-*.cjs` require isolated profile/data paths.
  `scripts/qa-iterative-sdxl.py` is opt-in and requires an explicit model ID and
  temporary data directory. Tests never use the live app data directory.

Verified results:

- 578 backend tests passed with temporary data, logs and model roots and no
  inference network access. 263 frontend tests passed. Vite production build
  passed, including the repaired Face Bank recompute export.
- Real Electron launch against isolated app storage: chats, image model lists,
  workflows, characters, queue and system stats returned 200; unauthenticated
  private access returned 403. Desktop IPC accepted the legitimate main frame;
  no credential appeared in the desktop document URL.
- Real Electron scene UI: creation, field editing, autosave, tab persistence,
  saved-scene selection and reload passed. A screenshot was inspected. Separate
  file-origin migration QA copied a seeded preference/profile to app origin and
  verified the original was unchanged.
- Deterministic inference tests verify txt2img-to-img2img transitions, shared
  component identity, hook switching, output lineage, recovery and cancellation.
- A separate real SDXL smoke test did **not** complete: Windows terminated
  Python in `torch_cpu.dll` with access violation `0xc0000005` while loading the
  checkpoint. No test frame was produced. End-to-end SDXL continuity and image
  quality are therefore unverified on this runtime. This native failure is not
  established to be caused by the scene changes; no dependency replacement or
  user-model change was attempted.

Desktop startup changes require a full restart. Existing FastAPI startup/shutdown
event deprecation warnings do not fail tests.
