# Mobile companion roadmap and progress

## Goal and acceptance

Build a responsive, installable phone client while the desktop owns inference,
GPU scheduling, conversations, images and durable job records. Completion requires
tested streaming chat and synchronized conversations, image generation with
settings and progress, gallery viewing, and full-resolution downloads. Sharing,
reconnection and phone suspension must work without duplicate submissions.

Keep existing desktop behavior, models, data and Git history intact. Use the
normal shared `main` checkout and preserve pre-existing changes. Never equate
mocked inference or a browser emulation with a real phone/GPU/network test.

## Architecture and dependencies

- A separate React/Vite PWA entry point, built into `dist/mobile`, with Chat,
  Generate, Gallery, Jobs and Connection views. No Electron dependency.
- A separate, opt-in mobile gateway; the desktop API's loopback binding and
  per-launch credential remain unchanged. No generic API proxy or arbitrary
  filesystem/command endpoint. PC bridge browser restrictions remain unchanged.
- Reuse `session_store` revision checks and stable message/image IDs; append
  server-owned turns and refresh authoritative history instead of replacing it.
- Reuse the existing `/chat` and image-generation routes and shared request/GPU
  queue through authenticated loopback calls. Persist mobile job receipts and
  progress independently of browser connections, using the existing durable
  bridge-store mechanism in a separate mobile data directory where appropriate.
- Reuse the gallery/session image services and their hidden/locked-image checks.
  The gateway returns only explicitly mapped media URLs and bounded metadata;
  original image bytes come from those services, never caller-supplied paths.
- Streaming observers can reconnect to the same job. Durable partial results
  and job IDs allow recovery after a page closes. A desktop process restart
  reports unfinished work as interrupted instead of silently replaying it.
- Offline caches contain only the application shell. Conversation/image data and
  credentials must not enter service-worker caches, URLs, logs or web storage.

## Approved security implementation design

Implement an off-by-default gateway with a desktop-only start/stop/pair/revoke
control surface. A short-lived, single-use, high-entropy invitation grants a
named phone access to existing conversations and unlocked gallery images and
permits bounded chat/image requests. Keep per-device credentials hashed at rest;
use secure HttpOnly same-site cookies, exact Host/Origin validation, CSRF checks,
bounded bodies, request throttling, and revocation. No vault unlock or desktop
administration endpoints are exposed to the phone.

Serve the PWA and mobile API at one trusted HTTPS origin. Support either a
private-address HTTPS listener using explicitly supplied trusted certificates,
or a loopback gateway behind an explicitly configured private VPN HTTPS proxy.
Never enable public hosting, router forwarding, firewall changes, certificate
trust installation, or VPN setup automatically. Browser trust in TLS must be
established before phone pairing; do not recommend bypassing certificate errors.
The user approved implementation on 2026-10-17. Actual network enablement requires a separate concrete
configuration review and approval.

## Milestones

| Milestone | Deliverable | Status |
|---|---|---|
| 1. Inspect and design | Source/dependency map, isolated validation plan, security review | Complete |
| 2. Mobile client | Responsive PWA, API client, reconnection and submission receipts | Implemented; Chromium QA passed |
| 3. Durable desktop integration | Streaming chat/history, generation jobs/progress, gallery/media | Implemented; mocked and real inference verified |
| 4. Approved gateway | Pairing, revocation, TLS/host/origin/CSRF boundaries, desktop controls | Implemented; private HTTPS fixture verified |
| 5. Automated verification | Isolation, race/retry/restart/security tests and browser QA | Passed; physical device evidence remains separate |
| 6. Device verification | Approved private connectivity and actual phone/GPU acceptance | User reports four core functions working; final parity fixes tested in fixtures, awaiting updated live build |
| 7. Publication and handoff | Reviewed task-only commit/push, verified remote, setup guide | Pending |

## Validation plan

Use temporary app-data/model/log/catalog directories for backend tests. Exercise
real route/queue adapters with deterministic inference fixtures first, including
lost acknowledgments, concurrent session changes, cancellation, disconnects,
restart records, pairing expiry/reuse, unauthorized origins and media access.
Build the mobile bundle separately from the existing desktop build and validate
at phone viewport sizes. Check service-worker caching and install metadata.
Run focused desktop regressions for reused interfaces. Only then perform a
bounded real chat/image test if local runtime conditions permit. Record the
actual tests and limitations below as work proceeds.

## Progress log

### 2026-10-17 — Initial inspection

- Verified the normal checkout resolves to the desktop's E: project directory;
  `main` tracks `origin/main`, with fast-forward-only pulls and simple pushes.
  Fetched and ran `git merge --ff-only origin/main`: already up to date at
  `b6e28bc895e1aa9f27b65755a08863dd3064af53`.
- Found pre-existing image-generation, timing, gallery and stitcher edits. The
  user confirmed no other chat/computer is editing and instructed preservation.
  Those changes are outside this task and must not be staged or published.
- Read architecture/development guidance and inspected bridge, session, queue,
  image-task and gallery contracts. Existing image tasks survive a browser
  refresh but are memory-only; bridge jobs already supply durable receipts and
  interrupted-on-restart semantics. Session revision checks now exist.
- The earlier mobile feasibility assessment is historical context only; this
  roadmap follows the current four-function request, not its older wider scope.
- No service, firewall, certificate, network or runtime setting changed.

## Remaining device evidence

- Private HTTPS setup and Android pairing are complete.
- Real phone install/reconnect/share/download and desktop inference evidence.
- Until those checks pass, the application goal is incomplete.

### 2026-10-17 — Implementation and first verification

- User approved gateway implementation, with network configuration to be
  reviewed separately. No live listener or firewall/VPN/trust changes made.
- Added separate mobile build, responsive client, shell-only service worker,
  secure device pairing/revocation and desktop Dashboard controls.
- Added durable mobile receipts using `BridgeStore` in a separate directory,
  server-owned chat streaming, existing image tasks/queue integration, revision
  checks, original gallery downloads and current visibility/vault checks.
- Mobile production build passed. First focused checks: 19 backend tests and
  5 frontend tests passed. Backend integration uses real desktop routes and the
  shared queue with inference mocked; synthetic gallery downloads match the
  original bytes. Real phone/GPU/network behavior is not established.
- Chromium QA under development uses temporary app data and an exact trusted
  fixture certificate on loopback. It does not use live app data or OS trust.

### 2026-10-17 — Integrated browser, desktop and GPU evidence

- Chromium QA passed against a real loopback HTTPS gateway with synthetic
  inference at a 390×844 window size: pairing, streaming chat, reload during a
  job, saved history, image job/gallery, original-image download hash, secure
  HttpOnly cookies, no private CacheStorage/web-storage data, offline shell,
  automatic reconnect and logout revocation. Screenshots were reviewed.
- A separate real-inference smoke test used installed chat/SDXL models and the
  desktop GPU, with all output and session data in a temporary directory. Chat
  returned the requested marker; image generation completed at 512×512 with two
  steps. The mobile gallery served the output and the original download matched
  its bytes. This verifies the execution path, not final image quality or phone
  network performance. Existing model weights and application data were preserved.
- Full frontend suite at that point: 1,469 passed, 3 existing skips. Backend
  focused/security checks then expanded to 23 passing tests. A committed-main
  snapshot plus only task files passed 171 backend integration/security/build/
  publication checks before the final small lifecycle/error-handling additions.
- Added desktop activity synchronization through the shared polling observer,
  reusing the existing safe-reload checks for both chat panes. Additive phone
  results refresh idle desktop conversations without replacing local edits or
  active streams; focused synchronization tests passed.
- Updated normal build/source-capture/publication handling for the PWA. Only
  the exact generated install-icon hashes are allowed as binary assets. Source
  privacy scan found no problems in the 41 task files reviewed at that point.
- Added the desktop maintenance interlock. Saved Images downloads use the
  committed desktop content route, avoiding another task's unpublished changes.
- Read-only checks found a loopback-only Ollama listener and no detected
  Tailscale command/service. No desktop mobile listener, VPN, firewall rule,
  public hosting, router forwarding or certificate trust has been enabled.

## Current continuation boundary

The user confirmed Android, no existing private VPN, and approved installing
Tailscale plus private Serve forwarding to loopback port 8766. Complete the approved
setup after the user signs in on desktop and phone. Physical-phone install, native sharing, phone sleep/reconnect,
and LAN/remote access remain unverified. Keep the goal incomplete until those
checks pass. Do not commit/push incomplete work automatically; publication and
the desktop/laptop readiness handoff remain pending final acceptance.

### 2026-10-17 — Final review and approval boundary

- Latest full frontend run: 1,474 passed, 3 skipped, including the desktop-control
  test verifying that setup restoration never starts the gateway automatically.
  All 24 mobile backend tests passed. The preceding 23-test suite also passed in
  the clean committed-main overlay, including Saved Images byte streaming through
  the original desktop route. The added real-TLS lifecycle test covers port
  conflict/retry, persisted configuration, pairing across listener restart and
  revocation.
- Latest Chromium run again passed the full synthetic HTTPS/phone-view workflow.
  Normal desktop-plus-mobile production build passed. Existing Vite large-chunk/
  bundled-module warnings and FastAPI lifecycle deprecations remain warnings.
- Every pre-existing modified/untracked task file matched its initial SHA-256.
  The most recent fetch still showed local `main` and `origin/main` equal.
- A concrete private Tailscale installation/Serve proposal was submitted for
  approval. No response/approval has yet been received. Do not install/configure
  VPN software, enable the live mobile listener, change firewall/certificate
  trust, or infer approval from elapsed time.
- Commit and push have not been performed: device/network acceptance and the
  overall implementation request remain incomplete. The other computer is not
  ready to continue this in-progress local work; it has not been inspected.

### 2026-10-17 — Private network setup approved

- User confirmed the acceptance device is Android and no private VPN is installed.
- User explicitly approved installing Tailscale on this desktop and configuring
  private Tailscale Serve HTTPS forwarding to `http://127.0.0.1:8766`, after
  account sign-in. This resolves the earlier network-approval blocker. Public
  Funnel, router forwarding, and unrelated network changes remain outside scope.
- Rechecked the normal checkout, main/upstream, destinations and pull/push rules;
  fetched and fast-forwarded successfully with no remote movement. Existing dirty
  work remains preserved. Account sign-in and actual device verification are next.
- Installed Tailscale 1.104.1 through Windows Package Manager from the official
  Tailscale MSI; package hash verification passed. The user accepted the Windows
  administrator prompt. The service is running and initially reported `NeedsLogin`.
- Started the interactive desktop sign-in flow and supplied the user its login
  link. No account credentials or login links are stored in this repository.
  Added a concrete Android Wi-Fi/cellular, install, share and reconnect checklist
  to the setup guide.
- User completed desktop and Android sign-in and the Serve/HTTPS account step.
  CLI status confirmed both devices online and a successful direct VPN ping.
  Serve configuration contains HTTPS port 443 forwarding only to loopback port
  8766, with no Funnel entry. Route acceptance, exit-node advertising and SSH
  remain off. Device names, tailnet addresses and login URLs remain local.
- Saved the verified HTTPS origin in local mobile configuration without enabling
  automatic startup. The desktop backend is healthy; its mobile listener still
  awaits the desktop start action. A normal HTTPS request trusted the issued
  certificate and returned the expected 502 while the local gateway was off.
- Desktop and mobile builds passed after the Android-guide update. All 33
  pre-existing changed files still match their initial hashes. Phone pairing
  and end-to-end acceptance remain pending; no commit or push yet.
- The desktop mobile listener is now running on loopback port 8766. Verified
  through the real Tailscale HTTPS origin: the application shell returns 200;
  an unauthenticated `/api/state` request returns 401. Certificate validation
  remained enabled. This proves the private proxy and authentication boundary,
  not yet the phone's four-function acceptance workflow.

### 2026-10-17 — Android pairing and live chat

- User confirmed successful Android pairing and a visible Chat screen. A read-only
  check of the local device store confirmed one enabled paired device and one
  completed phone chat job. Phone-visible streaming and desktop synchronization
  still require the user's observation.
- Requested the phone image-generation, Gallery and original-download checks.
  Native sharing, installation, suspension/reconnection and cellular access remain
  unverified. Keep the running desktop/bundle unchanged during these device tests.
- Updated publication guidance to describe the two exact-hash install icons as
  bundled asset exceptions, matching the implemented source-export checks.

### 2026-10-17 — Generate parity and prompt retention

- User reported chat, image generation, Gallery and downloads working on Android.
  They identified two integration gaps: phone images appeared only after opening
  Gallery, and phone generation settings differed from desktop Generate. They
  clarified the expected destination is Generate's output area. They also reported
  that generation cleared the positive prompt while retaining the negative one.
- Mobile Create now reuses the desktop size/ratio, steps, guidance and seed
  controls and shared defaults. Model recommendations, compatible LoRAs and
  strength, long-prompt encoding and longer-wait limits flow through the existing
  desktop serializer and image-task API. Catalog replies exclude filesystem paths.
  Both prompts and chosen settings remain after submission.
- Desktop Generate observes durable phone image jobs through a desktop-only
  snapshot route, including progress, cancellation and saved output. Initial
  polling order, existing desktop batches and Clear behavior have regression
  coverage. New completed image receipts retain their lightweight output record
  across restarts; older receipts created before this change remain in Gallery.
- Focused backend suite: 27 tests passed. Full frontend suite: 1,479 passed and
  three existing skips across 180 files. Chromium HTTPS QA passed with synthetic
  inference, checking both prompt values after generation, forwarded LoRA/seed/
  steps/guidance, desktop output records, Gallery, original download hash,
  streaming/reload/reconnection, cache exclusion and logout. Both desktop and
  mobile production builds passed into isolated temporary output directories.
  Existing Vite bundle-size/module and FastAPI lifecycle warnings remain.
- These parity fixes have not been loaded into the running desktop/Android
  session. A coordinated production rebuild, full Electron exit/restart, explicit
  mobile start and phone shell refresh remain necessary. Native sharing, PWA
  installation, actual phone suspension and cellular access remain unverified.
- Source edits are frozen after this bounded fix. The user-authorized publication
  chat owns combined review, remaining stitcher repair, commit/push and runtime
  deployment coordination. This chat did not stage, commit, push or restart the
  live desktop, and will not resume edits without further coordination.
