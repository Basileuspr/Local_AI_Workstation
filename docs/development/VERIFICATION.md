# Verification record and open findings

This is the consolidated evidence record, updated October 30, 2026.
Current guides describe inspected source; dated tests below are not a certification
of every feature, provider, installation or device.

## October 30 Testing Lab

The [Testing Lab guide](../workspace/TESTING_LAB.md) documents the persistent
text-model evaluation workspace, ten synthetic starter cases, custom immutable
suite revisions, pasted online baselines, separate automatic/human scores,
response evidence, history charts, finite local schedules and JSON/CSV exports.

- Full frontend suite: **1,641 passed, 3 existing skips across 205 files**.
  Complete backend/companion suite passed with **3 skips** and existing dependency
  deprecation warnings. Subsequent focused checks on the final evaluation,
  API, maintenance and reset changes passed **101 tests**, including all **14
  evaluation tests**. Runtime test locations were disposable.
- Backend checks cover exact/JSON/text assertions, numeric versus boolean JSON,
  unscored cases, missing/expired reference handling, immutable snapshots,
  manually recorded response provenance, independent human scoring, failure
  coverage, cancellation before startup and during work, retained interrupted
  results, schedule persistence/limits, maintenance exclusion, unavailable-store
  preservation, session authorization and bounded request schemas. Mock Ollama
  streams verify protocol fields, measured-token calculations and release of
  queue admission on success/failure. They are not real inference results.
- Hidden Electron/Chromium walkthrough passed for online-response recording,
  saved reviews, exact-prompt inspection, keyboard chart navigation, suite
  customization, local-only schedule creation/disabling, JSON/CSV downloads,
  history after reload, internal scrolling and 430 px layout. Screenshots were
  inspected. All model responses and historical points in this walkthrough are
  explicitly synthetic fixtures.
- Documentation links and production desktop/companion compilation passed.
  The desktop Vite root now resolves beside its configuration, keeping launches
  through a directory junction consistent with canonical module paths.
  Existing running application processes are not restarted as part
  of fixture QA. No actual paid/online model, live-source verification, long-term
  soak run, real GPU inference, native-phone or fresh-install acceptance is
  established by these checks. Schedules require the backend open and host awake.

## October 30 Coding Coordinator language runners

The [Coding verification guide](../workspace/CODING_COORDINATOR.md#language-runners)
documents SQL, Java/JVM, JavaScript/JSX, HTML/CSS, C/C++, TypeScript, Python and
.NET recipes alongside the retained Rust/Go checks. These replace the earlier
Java detection-only limitation. Runners remain independent of the selected model.

- Frontend: **1,634 passed, 3 existing skips across 204 files**. Selected backend
  language/coordinator, approval, tool execution/registry, maintenance, queue,
  model-runtime and session-guard suites: **148 passed**, with four existing
  FastAPI deprecation warnings. Runtime data was disposable.
- Actual positive and negative source checks passed for SQL, HTML, CSS, JSX,
  TypeScript, Java, C, C++ and Python. Tests also cover an oversized ignored SQL
  file being parsed instead of silently skipped, wrapper-version mismatches,
  missing tools, stable selection when source files are added, distinct .NET
  project names, changed-dialect grant invalidation and protected user drafts.
- Actual CMake/CTest builds accepted a working C program and rejected a failing
  test. Additional disposable Git fixtures exercised Maven/Gradle JUnit tests,
  C# compilation and .NET xUnit tests through the coordinator's contained runner:
  valid code passed and deliberate failures failed. Empty Gradle/.NET test suites
  failed. Cache activity did not invalidate otherwise unchanged JVM approvals.
  A deterministic Java coding task waited for permission, compiled the edit and
  preserved an existing user draft.
- Both isolated Electron walkthroughs passed, including the SQL/Java recipe
  descriptions, execution evidence, approvals and narrow layout. Screenshots were
  inspected. The shared Coordinator fixture now waits for its asynchronous action
  lock after cancellation before reopening the transfer confirmation; application
  transfer behavior is unchanged.
- Optional validators were installed outside the checkout and application venv:
  SQLFluff 4.5.0, HTML-validate 10.17.0, Stylelint 17.16.0, TypeScript 6.0.3,
  Babel parser 7.29.8, CMake 4.4.4, Ninja 1.13.0, Maven 3.10.0 and Zig 0.17.0.
  Native archives passed their pinned checksums; the separate Python environment
  passed `pip check` and the validator npm dependency audit reported zero findings.
  Installed JDK 21, Gradle 8.13 and .NET SDK 9 were used for the live fixtures.
  Dependency preparation was explicit; coordinator checks never install packages.
- SQL acceptance establishes dialect grammar, not schema/data correctness or
  successful database execution. Web validators establish static checks, not
  browser behavior. Kotlin/Scala/Groovy and F#/Visual Basic project discovery is
  covered; their compilers were not live-tested. Rust/Go toolchains were unavailable
  for live acceptance. Non-Windows execution and fresh tool installation on a
  clean OS were not tested. GPT-OSS/Qwen inference and physical-phone behavior were
  not rerun. Desktop assets use separate build output; the live app is not restarted.

## October 30 Coordinator harness workspace

[Coordinator](../workspace/COORDINATOR.md) is a main tab with Coding,
Research & Knowledge and Media Librarian. Existing coding controls and storage
are retained; research and media have versioned durable runs and explicit actions.

- Frontend: **1,633 passed, 3 existing skips across 204 files**. Selected backend
  coordinator, coding verification, research, media, registry and maintenance
  suites: **113 passed**, with four existing FastAPI deprecation warnings.
  A final focused run passed **10 Coordinator tests**, including one additional
  test for disconnected HTTP actions retaining their maintenance lease until
  file workers finish. Backend runtime directories were disposable.
- Tests cover retained research evidence and explicit Knowledge receipts,
  interrupted-state recovery without replay, strict request contracts, foreign
  model IDs, metadata staleness, retained tags, single-use transfer plans and
  partial completion. An actual fixture applies metadata and copies a registered
  image, verifies byte equality and source preservation, then rejects replay.
- The isolated Coordinator Electron walkthrough passed harness switching, draft
  retention, combined Coding history, explicit Knowledge saves, reviewed metadata,
  transfer preview, cancellation/confirmation, and narrow layout. Screenshots were
  inspected. The full-app Design & Programming walkthrough also passed with the
  new main tab and six remaining design destinations; non-failing Chromium widget
  diagnostics remain present.
- Model responses and web evidence were deterministic fixtures for these checks.
  Live GPU/model quality, public-provider availability, real Knowledge embeddings
  and physical-phone behavior were not retested. Media planning is metadata-only;
  duplicate candidates use recorded hashes in the selected set. Research/media
  tasks support Stop and explicit restart as a new task, not pause/resume.
- Desktop compilation and installation use a separate build output and retain
  existing hashed assets. The phone build is left intact; the live application is
  not restarted. Captured source identity records the pre-commit worktree.

## October 30 Coding Coordinator Verification Manager

The manual command box is now an advanced option under a project-aware
[Verification Manager](../workspace/CODING_COORDINATOR.md#verification-manager).
Configuration discovery is read-only; profiles, execution grants and command
history are separate. Final check selection considers changed languages/packages.

- Frontend: **1,629 passed, 3 existing skips across 203 files**. Coordinator,
  verification, tool execution, queue, model runtime, registry, session and
  maintenance backend suites: **120 passed**, with four existing FastAPI
  deprecation warnings. Backend runtime paths were disposable.
- New backend checks cover read-only discovery, malformed manifests/settings,
  nested package directories, fixed Rust/Go recipes, missing runners, profile/grant
  separation, fingerprint invalidation, stale native approval requests, denial,
  remembered approvals, manual execution and pause while waiting. A model's
  request cannot bypass manual mode. Editing a previously approved custom check
  requires fresh approval. Actual Python and npm child processes exercise success,
  failure, working-directory and output receipts; Rust/Go recipe detection is not
  a live compiler acceptance test.
- The isolated Electron coordinator walkthrough passed detection, profile
  save/load, approval/revocation, execution prompts, manual decline, distinct
  passed/not-run history, preserved-file display and narrow layout. Desktop and
  narrow screenshots were inspected. The full-app Design & Programming fixture
  also passed; Chromium emitted widget diagnostics without failing its assertions.
- Provider/model integration remains interchangeable and unchanged. The earlier
  GPT-OSS 20B/Qwen workflow acceptance below was not rerun for this UI and execution
  policy change; these new policy tests use a deterministic model fixture.
- Checks still use the account's OS permissions. Process limits, credential
  filtering, isolated Workstation runtime paths and explicit grants are not an OS
  sandbox. Selection is a language/package heuristic, not dependency-graph coverage.
  Java/Gradle/Maven are detected without a direct runner recipe. No dependency
  installation, live app restart or physical-phone acceptance was performed.

## October 30 Coding Coordinator milestone 1

The desktop Coding Coordinator was prepared and validated in isolated checkouts,
then applied to the normal checkout after explicit approval. The live application
was not restarted; use **File → Exit & Restart** to load the approved build.
It adds project selection, native tool calls, protected existing edits, durable
task state, Python/Node checks, pause/resume, and a separate model review. There
is no built-in Git publication action or operating-system permission sandbox.

- Reconciled in an isolated checkout against `4e1fe90`, retaining the
  completed UI mirror and Knowledge constellation changes and their verification records.
  Original staging artifacts and six pre-existing draft backups remain retained.
- Final frontend: **1,627 passed, 3 existing skips across 203 files**. Selected backend
  coordinator, tool execution, queue, model handoff, session and maintenance
  suites: **108 passed**, with four existing FastAPI deprecation warnings. Both
  were repeated from the normal checkout with disposable backend runtime data.
- Windows checks exercised actual command exit codes, cancellation, timeouts,
  credential omission and descendant cleanup using a private Job Object. Source
  tests covered dirty/staged/untracked preservation, stale hashes, external
  edits, links, instruction scopes, concurrent writers and interrupted recovery.
- The isolated Coding Coordinator Electron fixture passed explicit project/start,
  model selection, diff/check output, preserved-file display and narrow layout.
  Desktop and narrow screenshots were inspected. The existing full-app Design &
  Programming Electron fixture also passed its navigation and editing checks.
- Real local Ollama **0.34.3** acceptance used disposable Git projects with one
  arithmetic bug, three assertions, and a pre-existing user edit. GPT-OSS 20B
  completed the coordinator run in **71.55 seconds** with a 16,384-token context;
  the same fixture without the separate reviewer completed in **43.25 seconds**.
  A second GPT-OSS run with the default **8,192-token** context passed in
  **71.49 seconds**. Qwen3.5 9B also passed, in **129.56 seconds** at 16,384 tokens.
  All runs preserved the user edit, check file and Git HEAD and changed only the
  requested source file. These are small workflow acceptance runs, not model
  rankings; warm model state, reasoning settings and model decisions differ.
- Desktop and companion production compilation and documentation link checks
  passed in the isolated checkout. Builds retained the existing large-chunk and
  manifold browser-externalization warnings. Preparation builds left deployed
  assets untouched; the approved checkout build is available for the next restart.

Larger coding tasks, broad model quality, Linux/macOS check execution, hostile
project isolation, Android installation and physical-phone behavior were not
validated. No dependencies or models were installed. See the
[Coding Coordinator guide](../workspace/CODING_COORDINATOR.md) for scope and usage.


## October 30 Knowledge constellation design and navigation

The follow-up design replaces the enclosing box with an open constellation,
restrained node glow, lighter labels, and a floating Orbit/Pan/zoom/Fit/Focus dock.
View contains camera presets, smart/all/focus labels and optional orbital depth
guides. Expand hides the side panels while retaining their mounted editor state.
Camera transitions respect reduced motion, and pitch stops at the poles to keep
the scene upright. Saved coordinates, symbols, custom appearance and locks remain
in the existing data model.

- Full frontend validation passed **1,622 tests across 202 files**, with **3
  existing skips**. Geometry tests cover constellation fitting, upright orbit,
  and labels avoiding nodes whose own labels are hidden.
- The production-frontend/real-endpoint Electron fixture passed **18 checkpoints**
  without renderer errors. It covers real orbit/pan input, zoom, offscreen recovery,
  camera presets, double-click focus, expanded view and unsaved draft retention,
  keyboard controls, lost pointer capture, persisted xyz/depth dragging, locking,
  custom symbols/styles, search, linking, reload and authored content editing.
- Separate **1-node and 48-node** disposable scenes passed smart/all/focus label,
  expansion and narrow popover checks. Wide, expanded and 390px screenshots were
  inspected. The dense scene uses smaller node markers; label placement considers
  unlabeled nodes as obstacles. The camera preset row remains on one line despite
  shared workspace control styles. Very crowded layouts can still need zoom or
  Focus; the renderer does not rearrange saved node positions.
- The isolated desktop build passed with the existing chunk-size/manifold
  warnings. Documentation validation passed with zero errors; whitespace checks
  passed. QA uses `LAW_QA_DIST` for the isolated build and optionally
  `LAW_KNOWLEDGE_QA_SCENE=single` or `dense`; all fixture data stays disposable.

The running app was left open during validation; a full restart loads the new
desktop renderer. Backend unit suites, GPU generation and physical phone/Android
acceptance were outside this renderer change. The OS reduced-motion preference
was honored in source but not exercised through a live OS setting change.

## October 30 Knowledge graph contrast and spatial guides

The Knowledge graph now has a padded enclosing frame, a visible floor grid and
node-to-floor markers. Connections have stronger contrast, distant nodes retain
their brightness, and labels use backplates with collision-aware placement and
leader lines. Camera controls are outside the scene; a fixed-size compass,
visible-node count, **Show all nodes**, and selected XYZ coordinates aid navigation.
These changes preserve document positions, custom appearance and graph data.

- The full frontend suite passed **1,620 tests across 202 files**, with **3 existing
  skips**. The focused Knowledge suites passed **25 tests**, including fitting
  empty/flat/extreme volumes, clipping camera-plane crossings, separating labels
  and preserving world coordinates.
- The isolated production-frontend/real-endpoint Electron fixture passed all
  **17 checkpoints** with disposable data and no renderer errors. Coverage includes
  guides, readable clustered labels, offscreen recovery, orbit/pan/zoom/fit/focus,
  persisted node dragging and depth, locking, search, customization, reload and
  authored-node editing. Lost pointer capture cancels an unfinished move and the
  next drag still saves. Injected drags now carry pressed-button state and remain
  inside the test window so Chromium receives their release.
- Wide, rotated, selected and 390px screenshots were inspected. Narrow layout
  has no horizontal overflow. Screenshots wait for rendering before capture.
- The desktop production build passed with the existing large-chunk and manifold
  externalization warnings. Documentation and whitespace checks passed.

The desktop build is prepared for the next app restart; the live app was not
restarted during validation. Backend unit suites, GPU generation, physical-phone
and Android acceptance were outside this renderer change. Very dense graphs may
still need zoom or Focus node; label placement does not rearrange documents.

## October 30 UI Design Mirror Apply and Undo

The mirror now has an explicit **Apply to app** action after side-by-side review.
It stores per-element display overrides locally and replays them after view
remounts and app restarts. **Undo last application** restores the previous batch,
including after restart. Draft edits, comparison and optional JSON export remain
separate from application. Existing version-one drafts remain usable.

- Validation used an isolated checkout of `db58b6e` plus only this task's files;
  the six unrelated Knowledge Vault draft files were excluded. The full frontend
  suite passed **1,617 tests across 202 files**, with **3 existing skips**.
- Unit coverage includes target identity and ambiguity, request-only edits,
  unsafe style rejection (including image-set URLs), review tickets, conflicts,
  duplicate requests, persistence, Undo, renderer/save failure rollback and preservation
  of corrupt saved-design files. The main app and foreign frames cannot invoke
  the mirror's Apply or Undo IPC handlers.
- `node scripts/qa-ui-design-mirror.cjs --app` passed using disposable profiles,
  synthetic app responses and the actual React fixture. Six ready edits applied
  without changing neighboring headings, typed input, focus or button actions.
  Native menu and UX-note requests stayed unapplied. Original comparisons stayed
  frozen. Remount replay, fresh-host persistence, Undo after restart, stale-batch
  rejection and ambiguous targets passed. The actual app exposed **6,516**
  editable elements across **48** workspace slots; Apply, route-aware replay and
  Undo passed with no renderer errors. Desktop and narrow screenshots were
  visually inspected; no horizontal overflow remained.
- The isolated desktop production build passed with the existing large-chunk
  and manifold externalization warnings. Documentation links and whitespace
  checks passed.

Native Windows menu styling, written UX requests and embedded placeholders remain
request-only. Targets that cannot be uniquely matched need a new capture or a
more distinct target. Applied overrides are local display settings, not source
code changes or cross-computer synchronization. Validation did not restart the
user's live app or replace deployed assets; backend, GPU, physical-phone and
Android acceptance were not rerun for this desktop feature.

## October 30 workspace information audit

All 46 workspace guides were reviewed against current source. Corrections cover
phone pairing and updates, ordered jobs and batches, character intake, image
saving and original-resolution zoom, workflow asset limits, model/reference/LoRA
compatibility, and the Design & Programming navigation. The guides also explain
the completed UI Design Mirror's captures, individual requests, saved drafts,
comparison and export separately from the UI Playground's Apply to app action.

- Validation used an isolated checkout of the published UI Design Mirror commit
  plus only the information-guide changes. The unrelated Knowledge Vault draft
  was excluded. The full frontend suite passed **1,610 tests across 201 files**,
  with **3 existing skips**.
- The existing workspace-information Electron fixture passed for all **46**
  dialogs: scoped controls, open/close, focus restoration and no horizontal
  overflow. Escape preserved the chat draft; pinned help, embedded-surface
  coverage and narrow layout passed. Updated Design & Programming, Dashboard
  phone guidance and narrow-dialog screenshots were visually inspected.
- The isolated desktop production build passed with the existing large-chunk
  and manifold externalization warnings. Documentation validation passed:
  **55 Markdown files, 269 local links, 92 relocation entries, 0 errors**.
  Whitespace checks passed.

This was a help-text change. No runtime behavior, deployed assets, phone data or
live services were changed. Backend, physical-phone, Android-installation and
GPU acceptance were not rerun; the live app was not restarted.

## October 30 Design & Programming

### UI Design Mirror

The desktop **Design → UI Design Mirror** opens a sandboxed child with its own
minimal preload and ephemeral browser partition. Captures read mounted DOM and
already decoded pixels without fetching assets or mounting the React app again.
Per-element proposals, comparison and export never apply to the real app.

- Validation used an isolated copy of `main` plus only the mirror's task files,
  excluding the unrelated Knowledge Vault and info-bubble drafts. The full
  frontend suite passed **1,610 tests**, with **3 existing skips**. The focused
  mirror/shutdown checks passed **17 tests**, including immutable request history,
  target/property filtering, menu routing, IPC sender/frame guards, network
  allowlisting, serialized draft writes, restoration, capture limits and corrupt
  draft recovery.
- `node scripts/qa-ui-design-mirror.cjs --app` exercised the real child window,
  preload and sandbox with temporary profile/files and synthetic app responses.
  It checked single-heading font/size/color changes, unchanged neighboring/source
  controls, review counts and before/after values, export, reset/undo, disabled
  controls, placeholders, mounted-workspace selection, native-menu proposals,
  closed/open popovers, portal dialogs, multiple captures and a fresh host's
  restoration from disk. Network fetches, popups, injected scripts and foreign
  IPC callers were denied. The actual React fixture exposed over 6,400 editable
  elements across 48 workspace slots. Desktop/comparison/900-pixel captures were
  visually inspected; no renderer errors or horizontal overflow remained.
- Isolated desktop production build passed with the existing large-chunk and
  manifold externalization warnings. Documentation links and whitespace checks
  passed. No deployed renderer, running app, phone, backend, GPU service or
  unrelated draft was changed by validation.

Embedded/native surfaces and shadow-root internals are not editable DOM copies;
unmounted views require a new capture after opening them in the main app. The
native menu preview illustrates styling requests, rather than restyling the OS
menu. Live desktop restart, GPU generation and phone/Android acceptance were
not performed for this menu/editor-only change.

### Shared appearance playground

The main Design & Programming workspace groups the UI Playground, Styling
Library, HTML, CSS, JavaScript, and Markdown viewers. Existing source routes,
Functions, captures, search, and pins retain their destinations. Older saved
viewer priorities migrate into the workspace's internal tool order.

- Full frontend suite passed with **3 existing skips**. Focused tests cover
  navigation migration, preset/import normalization, draft persistence, generated
  offline source, appearance isolation, all palettes and accents, readable text
  at the contrast extremes, and application preference persistence/reset.
- Tool-registry and application-awareness backend checks: **24 passed**, using
  temporary data, logs, models, and catalog locations. Existing FastAPI lifecycle
  deprecation warnings remain. Design controls are interactive UI tools, without
  a fabricated callable backend endpoint.
- `node scripts/qa-design-programming.cjs` compiled the actual renderer to a
  temporary production bundle with synthetic API responses and an isolated
  Electron profile. It verified Apply/Undo, real navigation geometry, independent
  code drafts, preset save/load, library handoff, all 20 comparison components,
  ordering/removal, generated source, reduced motion, and reload persistence.
  Desktop and 420-pixel dark/light screenshots were inspected; there were no
  renderer errors or horizontal overflow. Headless Electron emitted benign Mojo
  widget messages during iframe teardown. The HTML/CSS sandbox continued to
  block scripts and network resources.
- Documentation links and `git diff --check` passed. This change does not certify
  model/GPU execution, embedded app restyling, phone/Android behavior, or a live
  desktop restart. Those are outside this renderer customization check.

## October 30 large-image transfers and zoom

Gallery/stitcher saves now use a native destination dialog, chunked transfers,
hash/length verification and atomic replacement. Saved copies can be opened or
revealed. Gallery filing updates membership without uploading the original;
Gallery/workflow uploads, catalog handoffs and ZIP64 exports no longer impose
generic megabyte gates. Image viewers support original-resolution zoom and pan.

- Full frontend suite: **1,593 passed, 3 existing skips**. A simultaneous build
  and unrestricted run caused a face-file fixture timeout; the full rerun with
  two workers passed without changing timeouts.
- Full backend run: **2,196 passed, 2 skipped**, with one ICO-preview regression
  found and repaired. The final affected backend suites then passed **228 tests**,
  with one directory-symlink test skipped because host permissions prohibit it.
  These checks used temporary storage, including a 25-megapixel original over
  64 MiB, streamed imports, folder membership, workflow copies, thumbnails, ZIP
  integrity, vault protection and preserving originals.
  The character-parts upload suite also passed **22 tests**, retaining its
  explicit processing limit so an oversized upload cannot be silently truncated.
- Native save tests cover a 70 MiB streamed file, cancellation, incomplete-copy
  cleanup and preserving an existing destination. Private vault inspection stays
  in memory; inspecting decrypted bytes does not create temporary plaintext files.
- Isolated Chromium verified a synthetic 60-frame, 6144 × 6144 grid, full-resolution
  100% and wheel zoom, keyboard/drag pan, native save/open/reveal, a byte-identical
  108 MiB PNG export, ZIP export and narrow layout. A GPU capture failure during
  concurrent live work was resolved by running this 2D fixture with software
  rendering. Screenshots were inspected; no renderer errors remained.
- Desktop production build passed with the existing large-chunk and manifold
  externalization warnings. Documentation check: **55 files, 267 links, 0 errors**.
  Mobile/Android and GPU generation acceptance were outside this change.

Decoder/canvas support, memory, disk space and operation-specific processing
budgets still apply. This does not certify every image size or hardware setup.

## October 24 Tailscale address detection

The open, visible mobile controls observe local Tailscale status approximately
every five seconds and on focus/network return. **Use Tailscale HTTPS address**
rechecks before filling the form. Detection preserves saved/manual addresses and
running connections, handles login/disconnection/renaming, and distinguishes an
unconfigured device hostname from a private Serve route to the selected port.
Public Funnel routes, other services and old device names are excluded. The
desktop-authenticated route returns no peer, account or login-link details and
does not initialize the phone gateway or change network settings.

- Full frontend suite with two workers: **1,587 passed, 3 existing skips**,
  including 10 mobile setup tests.
- Companion backend/publication plus session-guard tests: **132 passed**, with
  four existing FastAPI deprecation warnings. All storage was temporary.
- Initial concurrent runs exhausted test timing budgets; the unrestricted
  frontend run was stopped. The bounded frontend and backend reruns above passed
  without increasing any test timeout.
- Isolated desktop and phone production builds passed using installed local
  dependencies. Existing large-chunk and manifold externalization warnings remain.
- Synthetic Chromium checks passed address fill, disconnect/reconnect, saved-form
  preservation and narrow layout alongside the existing reset controls. The
  narrow mobile controls screenshot was inspected.
- Read-only detection against this PC found a connected device and an HTTPS
  hostname, and correctly reported missing Serve forwarding. No private hostname
  was added to source. Documentation links and whitespace checks passed.

Live assets, the running desktop, Tailscale Serve and certificates were not
changed for validation. Physical-phone connectivity, certificate issuance,
native Android installation and real provider/GPU inference were not tested.
The full unrelated backend/media suites were not rerun for this change.

## October 23 selective sanitizing and phone reconnect

Dashboard reset now supports all app data with phone setup retained, all app data
including setup, or fixed individual storage sections. Independent Image Manager
and Media Manager catalogs and external originals remain outside reset scope.
Phone setup retention copies only validated listener configuration; paired access,
invitations and phone jobs are cleared. A private recovery marker fixes the scope
through retries. A preflight failure with no marker restarts the untouched backend
so the selection can be corrected. Metadata exports never include retained URLs.

**Find Tailscale address** reads existing Serve configuration for the selected
loopback port and excludes public Funnel/other-service routes. It never changes
network settings or starts a listener. The read-only lookup found one configured
private HTTPS proxy on this computer; no private hostnames were captured in source.

- Complete backend suite: **2,285 passed, 2 existing skips**, 26 existing
  deprecation warnings. All tests used temporary app/model/catalog storage.
- Complete frontend suite: **1,579 passed, 3 existing skips**; a subsequent focused
  maintenance/Dashboard run passed **32 tests**, including the added preflight
  recovery case. These overlapping checks must not be summed.
- Media Manager: **124 Python and 23 Node tests passed**. `pip check` passed.
- Isolated desktop and hosted-phone production builds passed with fresh dependencies;
  existing chunk-size and manifold browser-externalization warnings remain.
- `scripts/qa-reset-controls.cjs` passed synthetic Chromium interaction checks for
  all reset modes, empty-selection blocking, typed confirmation invalidation,
  retry scope locking, initial focus, narrow layout and address discovery.
- Workspace information QA passed all **45** registered workspaces, including
  updated Dashboard reset and reconnect explanations, focus and narrow layouts.
- Documentation link checks and the outgoing source/privacy scan passed.
- `npm audit` reported **two pre-existing high-severity dependency entries** in
  unchanged Electron and Undici versions. This is a failed advisory check, not a
  clean dependency audit; the separate Dashboard publisher will require resolving
  it. Dependencies were not changed or replaced in the running application.

No real app data was sanitized. Live deployed assets and the running desktop were
preserved; coordinated build/restart and physical-phone re-pairing remain acceptance
steps. No Android source or APK change is required for these desktop controls.

## October 23 image workflow integration review

Reviewed the integrated `147b3d4` baseline, including the published scrolling/focus,
Web, companion relocation/features and Image Manager/Media Manager changes.
The remaining workflow corrections require full SDXL runtime readiness and
preserve transparency in CPU Lanczos PNG outputs. Workflows, iterative scenes and
Magic Edit display the unavailable runtime's reason while retaining editable drafts.

Validation also exposed a Windows process-inspection error that made LoRA restart
recovery reserve the GPU without a training lock. A per-process `OSError` now uses
the existing inaccessible-process rules. Recorded-worker identity and unreadable
Python-worker guards remain intact; unrelated processes are neither stopped nor
modified.

- Backend: **2,259 passed, 2 existing skips** in the complete clean run. The skips
  require Windows directory-symlink privileges unavailable to this test account.
  An initial complete run had one default-log-folder failure caused by the test
  runner's custom `LAW_LOG_DIR`; all 20 logging tests and the full rerun passed
  after removing that override. An earlier diagnostic run encountered a native
  Windows access violation during a timed stack dump; the large-folder test and
  subsequent normal runs completed without that crash. The 26 dependency/lifespan
  deprecation warnings remain.
- Frontend on the reviewed Vitest 4.1.12 environment: **1,576 passed, 3 existing
  skips**, across 198 files, using `--maxWorkers=4`. The first unconstrained run
  timed out in five unrelated filesystem/startup tests during concurrent checks;
  the complete bounded rerun passed without increasing test timeouts. The final
  readiness/help check passed another 61 overlapping tests after the scene-help edit.
- Workflow provider/storage/export checks passed **111 tests**. Subsequent
  recovery, HTTP admission and workflow execution checks passed **92 tests**,
  including a transparent multi-stage run and reference acceptance. These focused
  suites overlap and must not be summed.
- Media Manager: **124 Python and 23 Node tests passed**. The lockfile advisory
  audit reported zero vulnerabilities, and `pip check` found no broken requirements.
  The reused validation dependency tree had no missing/invalid requirements;
  npm listed three extraneous optional WASM packages. Project dependencies were
  not installed or replaced.
- Isolated desktop and phone production builds passed with Vite 6.4.4, with
  `recorded_files_match` for the captured desktop source. Existing chunk-size and
  browser-externalization warnings remain. Documentation checks passed for
  55 Markdown files, 266 local links and 92 relocation entries.
- Synthetic regressions cover missing SDXL packages with CUDA present, absent
  CUDA, ready-runtime refresh, RGBA/LA/palette/color-key transparency, opaque inputs,
  EXIF orientation, original bytes, cancellation and the 24-megapixel bound.
  Recovery checks include recorded PID identity and a real synthetic orphan.

The in-app browser inspection timed out before a usable DOM/screenshot was returned;
it is not a visual pass. Live assets and installed dependencies remain untouched.
The controlled installation/build/restart and live scrolling/focus acceptance remain
separate from this source review. No real model, training or GPU job was started.

## October 23 Image Manager browsing/stitcher and Media Manager fullscreen

Image Manager previews follow the active filtered/sorted catalog across pages,
with wrapping arrows and keyboard navigation. The shared Gallery stitcher accepts
revalidated catalog originals, retains pick order and writes independent Saved
Images. Media Manager fullscreen uses a normal playback surface and permits only
its visible, owned main frame while retaining all other permission denials.

- Frontend: **1,572 passed, 3 existing skips**; backend: **2,233 passed, 2 existing
  skips**. Media Manager: **124 Python and 23 Node tests passed**.
- Isolated desktop and phone builds passed with installed dependencies retained
  (Vite 6.4.3 and Vitest 4.1.11). Existing build chunk warnings remain.
- Real isolated Electron checks passed filtered page navigation, keyboard wrap,
  catalog stitch preview/save/download, byte-identical downloads, preserved
  originals, and refresh during an active scan. Gallery's existing stitching,
  reordering, download and narrow-window walkthrough also passed.
- Isolated Media Manager details and duplicate players entered fullscreen with
  visible playback controls and retained the same decoded video/position. Button,
  Escape and viewer-close exits passed, along with the existing isolation checks.

Live assets and dependencies were not replaced and the running application was
not restarted. Coordinated activation and acceptance against the live catalog
remain separate; these fixtures use disposable synthetic media.

## October 23 companion workflow fixes

The subsequent character intake adds explicit profile saves and visible Saved
Image references through More tools. Revision checks preserve phone drafts when
the desktop profile changes, and unrelated manual fields/references are retained.
Hidden/locked/missing references are unavailable; unlinking keeps original bytes.
No LoRA or raw-upload workflow is exposed.

The combined source passed 2,221 backend tests with 2 existing skips and 1,568
frontend tests with 3 existing skips. The synthetic HTTPS flow also passed
character persistence, stale-draft handling and reference zoom/reload checks.
Final companion backend/publication checks passed all 81 tests. Isolated desktop
and phone builds passed, with a matching desktop source record. No live assets,
installed dependencies or running application were replaced.

Phone conversations support explicit names and metadata-only renaming. Image
batches are accepted atomically with individual progress/cancellation, and queued
chat/image work runs in order within a conversation. Waiting prompts do not enter
earlier chat contexts. Completed images survive other members' failure/cancellation;
stable receipt retries cannot duplicate work.

Validation: 1,568 frontend tests passed with 3 existing skips, 68 companion
backend/publication tests passed, and an isolated phone build and synthetic HTTPS
Chromium walkthrough passed. The walkthrough included two same-chat turns,
preceding-reply context, naming and batching. See
[companion validation](../../mobile-companion/docs/VALIDATION.md).
Installed dependencies were retained; live activation, physical-phone acceptance
and real model/GPU inference were not performed.

## October 23 scrolling controls and input focus

The scrolling audit added bounded, pane-sized action/filter groups to Image Editor,
Gallery and its collections, Review, Image Manager, bundled Media Manager, Index,
Styling Library, Info Center, Hash Auditor, Shortcut Registry, file packaging and
conversion, local documents/databases, spreadsheet/code viewers, Folder Review,
GIF Maker, image workflows/scenes, LoRA, face/character curation, Sound Mixer and
the function editor. Existing independent scrolling layouts were retained in Chat,
Generate, Documents, Canvas, Web, Knowledge and the 3D editor. This is source-audit
coverage, not a completed visual walkthrough of every workspace.

Image/GIF export, workflow run, training, recording and document-save actions reuse
their existing handlers and disabled conditions. A source comparison checked 1,386
event-handler/disabled attributes across 35 changed components without unintended
differences. New tests cover toolbar stacking and pane resizing, Media Manager's
single set of connected filter/view controls, confirmation cancellation, and native
keyboard-focus handoff without activating background windows.

- Fresh isolated `npm ci` succeeded with the reviewed lockfile; Electron binary
  download was skipped because this validation did not launch Electron.
- Frontend on Vitest 4.1.12: **1,557 passed, 3 skipped**, across 196 files.
- Media Manager: **124 Python and 21 Node tests passed**.
- Full isolated desktop/mobile production builds passed on Vite 6.4.4, including
  source-identity capture. Existing large-chunk and manifold browser-externalization
  warnings remain. Live `dist`, installed dependencies and running app were untouched.
- Documentation links and Electron JavaScript syntax checks passed. Backend code
  was unchanged; its full suite was not rerun for this UI/focus change.

Live small-window/split-pane visual checks and Windows dialog/workspace typing
acceptance remain pending the coordinated rebuild/restart. Automatic approval
review rejected the isolated Electron QA launch as **blocked by policy**; no
alternative launch was used to bypass that restriction. Unit/DOM tests and builds
do not prove native desktop focus behavior or visual geometry on a running window.

## October 22–23 application review

The initial public baseline was `1ad69d9`. Five existing dual-chat files were
preserved during testing and subsequently published unchanged as `0b89f65`.
The consolidation started after fetching/fast-forwarding that source.
No application behavior or dependencies were changed by the documentation work.

| Check | Recorded result |
|---|---|
| Frontend, npm test | 1,525 passed; 3 skipped across 188 files |
| Backend, isolated pytest | 2,196 passed; 2 skipped; 26 deprecation warnings |
| Media Manager | 124 Python and 21 Node tests passed |
| pip check | No broken requirements |
| npm advisory audit | Before remediation: four affected packages, one high and three moderate; resolved below |

Backend tests used disposable data/model/log/image-catalog directories.
The review inspected navigation/help, session startup/attachments, shared response
controls, image/media workflows, storage, API guards, web/browser boundaries,
mobile source/build ownership and publication tooling. It was not an exhaustive
line-by-line review or penetration test.

Documentation corrections include exact response/thinking caps, attachment-created
sessions, current window-close behavior, bundled Media Manager, button-based image
plan confirmation, persistent Browser profiles, opt-in model tool execution and
published Android source. Superseded implementation plans and duplicated usage/
test narratives have been removed from current guides.

## October 23 consolidation checks

- Public docs reduced from 66 Markdown files to 32, with about 81% fewer words,
  including removal of repetitive generated history listings.
- 64 focused backend capture/publication/identity checks passed (four existing
  lifecycle warnings); three reader JavaScript logic checks passed.
- The documentation checker passed 243 local links across 50 public Markdown files
  and all 90 relocation entries, including destination anchors.
- Eight existing public snapshot payloads remain exactly unchanged. Generated
  narrative/history use only those approved observations, not private local captures.
- Source allowlist/privacy-pattern checks and whitespace checks passed.
- A real browser preview was unavailable in this session. Reader logic tests cover
  rendering functions, comparison/filtering and relocated/private links, not visual
  layout. The app was not restarted or redeployed.

## October 23 Web navigation and controls

Browser, Research & Sources and Reels Analyzer now share the Web navigation
group. Existing routes and side-pane destinations remain unchanged. Research
modes retain drafts and include the existing public page importer; Reels setup
separates account selection from local analysis. Shared help and Info Center
describe the new locations and the separate browser/public-retrieval boundaries.

- Full frontend suite: 1,538 passed, three existing skips across 192 files.
- Isolated web/import/research/recurring-source/Reels backend checks: 151 passed.
- `node scripts/qa-web-navigation.cjs`: actual app navigation, all four research
  modes, keyboard focus/selection, draft preservation, unique importer labels,
  Web information bubbles and 420px layouts passed using synthetic APIs.
- Existing Electron web and Reels fixtures passed: source chats/images, citations,
  selected rendered-page capture, explicit Knowledge handoff, verified fixture
  media acquisition, recovery, deduplication and session-preserving cleanup.
  The Reels fixture acquired two complete transfers and never visited a repository.
- All 45 AppLayout information dialogs passed scoped-content, focus-restoration,
  Escape, side-pane and narrow-layout checks. Documentation links and relocations
  passed the repository checker.

These fixtures used disposable profiles/data and owned synthetic pages/models.
They do not establish live-provider search, signed-in social-site compatibility,
real model/GPU quality, physical-phone acceptance or a running user's app reload.
No Electron/backend security policy, dependencies or phone assets changed.

## October 23 dependency remediation

The four affected packages are resolved in the updated lockfile. In the freshly
installed validation copy, `npm audit --json` and
`npm audit --package-lock-only --json` report zero
vulnerabilities. This is a dated registry result, not a guarantee against future
advisories. Counts refer to affected packages, not distinct exploits.

| Package | Before | Patched | Advisory addressed |
|---|---|---|---|
| vite | 6.4.3 | 6.4.4 | [Windows editor launch](https://github.com/advisories/GHSA-587h-7wmj-h5pm), plus the remaining Vite/editor findings |
| electron | 44.4.5 | 44.5.0 | [Pointer-lock attribution](https://github.com/advisories/GHSA-x562-297c-g43g) |
| @vitest/mocker | 4.1.11 | 4.1.12 | [Mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [redirect traversal](https://github.com/advisories/GHSA-xp26-3454-mjgp) |
| vitest | 4.1.11 | 4.1.12 | Updated together with @vitest/mocker |

The existing major versions and React plugin 4.7.0 are retained. The lockfile
also refreshes Vitest's Chai and tinyrainbow dependencies. Validation used Node
22.18.0. Final frontend/build checks used an isolated copy of `12172b0` plus
the dependency patch. Backend, Media Manager and Electron boundary checks used
`b7de8d9` plus that patch; their source and backend tests are unchanged through
`12172b0`. No Python dependencies were changed.

| Check | Result |
|---|---|
| Clean install with npm 10.9.3 | Passed; lockfile generated using temporary npm 11.21.1 after npm 10's resolver error |
| Frontend, npm test | 1,538 passed; 3 skipped across 192 files |
| Backend, isolated pytest | 2,198 passed; 2 skipped; 26 deprecation warnings |
| Media Manager | 124 Python and 21 Node tests passed |
| pip check | No broken requirements; compatibility check, not a vulnerability audit |
| Desktop and mobile production builds | Passed; existing desktop chunk-size warning |
| Electron browser foundation fixture | Passed on 44.5.0 in two hidden processes, including profile/restart isolation, sandbox/bridge boundaries, authenticated media and private-destination rejection |
| npm audit and lockfile-only audit | Zero vulnerabilities |

The first backend run used temporary paths containing `..`; storage guards
rejected them. The successful rerun used normalized absolute paths. The initial
path-setup failure is not an application regression or a passing test run.

Builds, profiles, captures and test stores remained disposable. These checks do
not restart or redeploy the normal desktop or phone interface. Existing running
installations retain their old Electron executable until shutdown and `npm ci`;
publishing the lockfile does not update them automatically. The separate full
desktop startup smoke launch was unavailable and is not counted as passing.
Native Android build/lint, physical-phone acceptance and live provider/GPU work
were not rerun for this JavaScript dependency update.

## October 22 Android and controls evidence

The earlier integration review recorded 15 Android JVM tests, release lint with
zero errors/six warnings and eight synthetic native-image-adapter checks.
It also recorded 11 response-control checks, 26 desktop behavior checks,
33 menu layouts, phone HTTPS/update walkthroughs and desktop/phone/APK builds.

Those fixtures covered pairing, queue/results, gallery gestures, original-download
hashes, cache isolation, revocation, update confirmation and failure recovery.
They did not include physical-phone installation or emulator acceptance.

Recorded APK identity:

- Package `com.localai.workstation.companion`, version 0.3.0/code 3;
  minimum API 29, target/compile 36.
- APK SHA-256: `4146998459ba8ff5d1c80200ac556031b0b2f482a01877adf6f49c1c47036d25`.
- Signing-certificate SHA-256:
  `d642cb971be0a6cf31eebb0a706ea8aef3b7561dcf74856b230f9d9a47fa898f`.
- v3 signature and 16-KB ZIP alignment were checked; package/certificate/permissions
  matched the prior upgrade artifacts. Keys and APKs remain private/local.

These receipts describe that artifact, not a later rebuilt APK. Native checks,
signing, installation and hosted-interface updates are distinct steps.

## Limits and remaining acceptance

- This documentation review did not rebuild/redeploy or restart the running app.
  Attempted direct Electron QA launches produced no result artifact and are not
  counted as passing UI tests.
- Physical phone, fresh Windows installation, accessibility hardware, actual
  provider credentials, GPU/voice quality and controlled performance benchmarks
  were not rerun. Source/fixture success is not live acceptance.
- General Brave/SearXNG provider search needs configured credentials/endpoints and
  a live check; direct page preview can work without them.
- Gallery stitcher downloads passed the October 23 synthetic Electron checks
  above. Acceptance against the live catalog and Windows playback loopback
  behavior remain separate; fixture results do not prove every live media path.
- A passing application suite does not validate every statement in a guide.
  Documentation checks also compare controls/contracts with source, resolve
  links/anchors and check publication scope.

## Repeating checks

Use [development](DEVELOPMENT.md) for commands and isolation. Record actual counts,
skips, warnings, source identity and unverified boundaries when updating this
record. Use the [review reader](../application-review/README.md) for historical
source/dependency metadata; its retained observations are not a fresh test run.

## Historical implementation records

The September 30–October 6 records have been condensed here. Their original
details remain in Git history; the source observations and benchmark data remain
in the review reader.

| Record | Implemented contract | Dated evidence boundary |
|---|---|---|
| R01, September 30 | Portable build identity records source fingerprint, dirty state, dependency versions and capture time; desktop/API report missing or mismatched metadata | Source/fixture/build comparison, not installation certification |
| R02, September 30 | Shared revision-keyed session/image metadata, combined history inventory and bounded legacy migration, with current vault filtering | Synthetic cold/warm listings; warm listings read zero session JSON bytes in the fixture |
| R03, October 1 | Stale whole-history replacements conflict; rename/compaction update metadata, and additive replies remain durable | Competing-client and delayed-navigation fixtures, not every possible client race |
| R11, October 5–6 | Startup reconciles interrupted LoRA runs without automatic replay; verified surviving workers retain the GPU lease until deliberate recovery | Synthetic disposable worker/process checks, not a production restart or real GPU training |

R11 checks exact worker identity, project/run and process creation details rather
than trusting a reused PID. Completed matching adapters can be reattached; data,
captions and run/checkpoint files remain. Unknown ownership or failed persistence
keeps recovery blocked/retryable rather than releasing the GPU prematurely.

[R02 benchmark data](../application-review/benchmarks/session-metadata.json)
is the retained machine-readable measurement receipt. These historical test totals
are superseded by the dated full-suite results above, not silently reassigned to
this consolidation.
