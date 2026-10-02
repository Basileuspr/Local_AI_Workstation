# Application awareness and maintenance

Implementation and completion record, October 2, 2026. This extends the current
Electron / React / FastAPI application. Existing unrelated working-tree changes
were preserved. No application or working-environment dependency update was
performed, and no commit or publication was made.

## 1. Existing architecture discovered

- Electron owns backend startup and the desktop maintenance credential. Existing
  maintenance gates prevent reset/backup while requests and model jobs are active.
- FastAPI already exposes `/system/stats`, `/system/software-specs`, `/status`,
  `/models`, `/version`, and captured build identity. `package.json` is the current
  package-version source; `build-info.json` identifies a captured source build.
- React uses the reducer/store and persisted preferences. Sessions are separately
  persisted JSON records with revision-aware updates and additive message saves.
- `contextMemory.js` estimates input usage, reserves output/retrieval space, and
  summarizes older turns while retaining recent messages. Model metadata and
  `LAW_NUM_CTX` determine configured windows. The provider payload can contain
  additional memory, retrieval, canvas, and document instructions.
- Fresh launches already open a blank draft. Explicit Refresh uses a one-time
  navigation marker. There was no release-feed update checker or approved
  dependency-update workflow.

## 2. Files created or extended

Created:

- `backend/services/environment_awareness.py`
- `backend/services/context_awareness.py`
- `backend/services/app_updates.py`
- `backend/services/dependency_management.py`
- `electron/dependencyMaintenance.js`
- `src/applicationAwareness.js`
- `src/components/ApplicationMaintenance.jsx` and `.css`
- `tests/backend/test_application_awareness.py`
- `tests/frontend/applicationAwareness.test.jsx`
- `tests/fixtures/applicationAwareness.html`, `.jsx`, and `.config.mjs`
- This reference/implementation report.

Extended existing code:

- `backend/routes/system_stats.py`, `backend/main.py`
- `backend/services/chat_influences.py`, `backend/services/session_store.py`
- `electron/main.js`, `electron/preload.js`
- `src/contextMemory.js`, `src/navigation.js`, `src/preferences.js`,
  `src/responseStyle.js`, `src/chatInfluences.js`, `src/useStore.jsx`, `src/App.jsx`
- `src/components/Header.jsx`, `InputBar.jsx`, `SettingsPanel.jsx`, `SoftwareSpecs.jsx`
- `tests/frontend/contextMemory.test.js`, `tests/fixtures/chatStartup.jsx`

These file lists describe this task's edits, not every change in the dirty tree.

## 3. Environment awareness

`GET /system/environment` returns a versioned structured snapshot. Static
hardware/runtime information is sampled on demand and cached for an hour:
OS/version, CPU/cores, installed RAM, NVIDIA GPU/VRAM/driver, Python,
standalone Node, installed Electron, running desktop Node/Electron when provided
by Electron, PyTorch version, CUDA build and CUDA availability, app version, and
separate voice runtimes. Missing readings remain null or empty with explanations.

`?refresh=true` refreshes static information. `?live=true` probes local Ollama,
lists its models, and reports installed backend capabilities. `?resources=true`
adds the existing resource sampler separately. There is no background polling
in this service or the new maintenance card. Existing Dashboard telemetry keeps
its own schedule. Native PyTorch probing runs in a bounded subprocess without
loading a model.

Live detection during this task reported Windows 11, i7-12700K, about 31.7 GiB
usable RAM, RTX 3070 / 8 GiB VRAM, Python 3.13.5, standalone Node 22.18.0,
installed Electron 44.4.5, and PyTorch 2.11.0+cu128 with CUDA available. This is
availability evidence, not an inference or GPU-generation benchmark.

## 4. Context-window awareness

`POST /system/context` accepts `model`, prepared `messages`, and `output_tokens`.
It returns a model-specific configured limit, estimated usage, system/image
estimates, output reserve, remaining budget, summary state, and limitations.
Ollama model metadata is cached for ten minutes; missing metadata uses the
configured application window. `/models`, ordinary chat, exclusive model warmup,
and compaction now use consistent capped windows.

The frontend meter labels estimates explicitly and exposes the selected model,
window, reserves, remaining input budget, and summarized-message count under
Chat options. Small configured windows are respected; exhausted budgets no
longer invent a 512-token floor. Empty summary results no longer advance the
summary boundary. Saved transcript messages remain intact.

Prepared-provider influence receipts include context estimates after server
instruction injection. Completed ordinary chat streams include provider
`prompt_eval_count` / `eval_count` when returned; these are saved with the reply
and shown separately as the last processed request. They do not claim exact
counting for the next request. Provider-side trimming remains explicitly unknown.

## 5. Application update checking

Dashboard → Application awareness and maintenance → Check for Updates calls
`GET /system/updates`. It reports current/latest version and `up_to_date`,
`update_available`, or `unable_to_check`. No installer is invoked.

There was no authoritative configured release feed to reuse. The abstraction
uses an operator-configured `LAW_UPDATE_MANIFEST_URL`, which must be HTTPS and
return JSON such as `{"version":"1.0.1"}`. Requests have an eight-second timeout,
bounded manifest size, no redirects, and no inherited proxy environment.
Absent/malformed/offline feeds return Unable to check, never Up to date.
There is no guessed GitHub repository or hard-coded release endpoint.

## 6. Dependency compatibility checking

Dashboard's Check Dependency Compatibility calls `GET /system/dependencies`.
Select the intended requirements profile; optional profiles are alternatives,
not one combined install. Python requirements, installed distribution metadata,
recorded lock targets, and transitive conflicts are checked. JavaScript uses the
installed semver implementation to check package ranges and package-declared
Node engine ranges, with lock versions also exposed.

Coverage includes core/document/database packages, image generation, Torch and
CUDA wheel declarations, audio/transcription, face/ONNX packages, media-codec
libraries, and separate voice interpreters. Voice Torch/CUDA targets come from
the existing installer script. Unconstrained/missing optional packages and
unknown interpreter compatibility are reported honestly. Installed package
metadata had no conflicts during the live check.

## 7. Dependency update safeguards

The supported automatic set is psutil, python-docx, pypdfium2, and SQLAlchemy,
at recorded lockfile targets that satisfy the selected profile. This can repair
an older/missing version or explicitly propose a downgrade to the recorded
compatible target; it never chooses the newest release blindly.

Preparation downloads binary wheels for the proposed and previous versions,
checks package identity, Requires-Python, dependency requirements, installed
dependents, and hashes, then returns an expiring proposal. It changes no installed
packages. Paths/hashes remain private to Electron main; the renderer receives
only a proposal ticket. Cancel and explicit Approve and install are separate.

Approval requires a valid ticket and unchanged environment/manifest fingerprint.
The owning desktop locks/drains the backend, refuses active work, stops that
backend, and runs a one-package worker. Installation uses isolated pip, staged
wheels, `--no-index`, and `--no-deps`. It verifies version and metadata conflicts,
attempts rollback on failure, verifies rollback, and restarts the backend. A
restart failure is surfaced separately from installation success.

Torch/CUDA, Electron/Node, AI runtimes, separate voice runtimes, and other packages
remain manual-review upgrades. There is no Update everything operation.

## 8. Default-setting corrections

Response style now offers Default, which injects no style instruction. Fresh
preferences select it; invalid style keys also fall back neutrally. Existing
saved named styles, explicit profiles, system prompts, roleplay, and memory/
Knowledge controls retain their user-selected meaning and remain visible.

Image RESET DEFAULT already restores fixed application values, clears selections,
and detaches custom presets without changing them. Verboa recommended settings
already require a separate explicit button. Default local voice follows the OS
local-voice selection. Appearance defaults affect rendering only. No inferred
personality or generation-preference system was added.

## 9. Startup and new-chat corrections

On startup in model/roleplay settings offers New Chat (the default) or Resume
Last Chat. It uses existing navigation infrastructure; Refresh still restores
its explicit one-time view. The last persisted chat identity survives writing
blank navigation, so a slow/offline startup does not erase the resume target.

New Chat clears the active draft/history/summary without overwriting any saved
conversation. A persistent session is created only on an explicit submission or
attachment action that needs one. New saved sessions use full UUID identities
instead of shortened UUID prefixes. Existing short session IDs remain readable.
Session-creation HTTP failures now raise clearly instead of being treated as a
valid session response.

## 10. Validation and limitations

- 109 focused frontend checks passed: context, neutral Default, navigation, startup
  recovery, approved-update lifecycle, influence receipts, and session revisions.
- 114 focused backend checks passed: environment fallbacks/cache, context metadata,
  release states/offline checks, requirements conflicts/missing dependencies,
  approval/fingerprint/expiry/hash rejection, failed-update rollback, authenticated
  routes, session preservation, and existing chat/session/API tests.
- An actual scoped pip installation succeeded in a newly created temporary venv
  with synthetic local wheels. This did not update the workstation venv.
- Browser testing used the real bundled App with fake services and separate
  origin/storage. Existing-history startup made zero session creations/loads/model
  requests; explicit resume loaded history; New Chat retained the old chat; sending
  created a separate chat. Resume preference and empty-history startup were
  checked. Maintenance approval UI was tested with simulated installation.
- The actual renderer graph compiled successfully to a scratch production output.
  Shared `dist` and captured build records were not replaced during concurrent
  work in another chat. Compile output still reports large-chunk advisories.
- Broad suite runs encountered a concurrently added 3D Viewer tab-registration
  frontend failure and four backup-import confirmation-text expectation failures
  outside this request's scope. They were not treated as passes or repaired here.
- No real dependency update, desktop stop/restart cycle, or GPU generation was
  performed. Binary ABI/feature execution is not certified by metadata checks.
- NVIDIA telemetry supplies GPU/VRAM information; unavailable/non-NVIDIA readings
  are explicitly incomplete. CUDA build/availability is distinct from proving a
  separately installed CUDA toolkit. Static snapshots can be stale until refreshed.
- Voice runtime reports check recorded Torch/CUDA pins and inventory; they do not
  certify successful voice inference or every source-package constraint.
- Release discovery needs a configured authoritative feed. Package maintenance
  needs network access during preparation and an available binary rollback wheel.
  Forced termination can leave staging files in the OS temporary folder.
- Context is estimated before inference. Provider templates/image tokenization
  vary, and provider truncation cannot be reliably certified from token counts.

## 11. Short manual test procedure

1. After concurrent edits finish, run `npm run build`, then fully quit/relaunch
   Electron to load frontend, backend, and preload changes together.
2. With saved history present, confirm startup opens New Chat; open an old chat,
   click + New Chat, send a new prompt, then return to the old chat and verify it.
3. In model/roleplay settings choose Resume Last Chat, quit/relaunch, and confirm
   the old chat resumes. Restore New Chat and test a clean/no-history installation.
4. Open Chat options: verify model/window, estimated usage and remaining budget;
   enable a named style then select Default and review Response influences.
   After a response, check its provider context receipt. Test long-chat compaction.
5. In Dashboard run Inspect Environment and Check Dependency Compatibility; choose
   the correct profile and review missing/conflicting/manual-review entries.
6. Check for Updates without a feed/offline: expect Unable to check. With a trusted
   HTTPS manifest configured, test equal/older/newer versions and malformed JSON.
7. In a disposable app installation, inspect a supported outdated dependency,
   cancel once, inspect again, and explicitly approve. Verify version and the
   affected feature. Test failed preparation/offline operation and failed update;
   inspect the rollback/restart result. Never alter the working venv just to create
   a failure fixture.

Implementation references: [pip installation controls](https://pip.pypa.io/en/stable/cli/pip_install/)
and [Ollama's provider API](https://github.com/ollama/ollama/blob/main/docs/api.md).
