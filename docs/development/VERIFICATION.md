# Verification record and open findings

This is the consolidated evidence record, reviewed October 23, 2026.
Current guides describe inspected source; dated tests below are not a certification
of every feature, provider, installation or device.

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
| npm advisory audit | Failed: four affected packages, one high and three moderate |

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

## Open dependency findings

The audit recorded these installed versions; counts refer to affected packages,
not distinct exploits:

| Package | Version | Highest severity | Advisory |
|---|---|---|---|
| vite | 6.4.3 | High | [Windows editor launch](https://github.com/advisories/GHSA-587h-7wmj-h5pm), plus other Vite/editor findings |
| electron | 44.4.5 | Moderate | [Pointer-lock attribution](https://github.com/advisories/GHSA-x562-297c-g43g) |
| @vitest/mocker | 4.1.11 | Moderate | [Mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [redirect traversal](https://github.com/advisories/GHSA-xp26-3454-mjgp) |
| vitest | 4.1.11 | Moderate | Through @vitest/mocker |

npm reported fixes available. Remediation remains a separate code/dependency task
requiring Electron boundary, desktop/mobile build and Vitest validation.
The Dashboard publisher’s audit gate is not green merely because tests pass.
pip check is compatibility checking, not a vulnerability audit.

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
