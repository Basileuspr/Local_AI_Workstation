# Verification record and open findings

This is the consolidated evidence record, reviewed October 23, 2026.
Current guides describe inspected source; dated tests below are not a certification
of every feature, provider, installation or device.

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
- Gallery stitcher download acceptance and Windows playback loopback behavior
  retain their previously unresolved live checks. Do not infer universal success
  from mocked or synthetic paths.
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
