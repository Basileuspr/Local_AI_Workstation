# Companion validation

## October 23 phone workflow fixes

Named creation and metadata-only renaming, atomic image batches and ordered
same-conversation jobs were checked using temporary app data and build outputs.

- Full frontend suite: 1,568 passed; 3 existing skips. Companion subset: 36 passed.
- Companion backend/publication suite: 68 passed, including batch quotas and
  partial results, individual cancellation, duplicate receipts, mixed work,
  preceding-reply context, future-prompt exclusion and deleted conversations.
- Phone production build passed in a temporary output directory.
- HTTPS Chromium walkthrough at 390 × 844 passed named creation/rename, two
  queued chat turns, preceding-reply context and a two-image batch, alongside
  existing pairing, image gestures/download, reconnect and private-cache checks.
- Local installed dependencies were used (Vitest 4.1.11 and Vite 6.4.3);
  dependency installation and live deployment remain with final activation.

The live desktop and deployed phone assets were not replaced or restarted.
Physical-phone behavior and real provider/GPU inference remain unverified.

## October 23 character intake

Profile names, biography, notes and tags share the desktop character store.
Visible Saved Image references use existing stable IDs; unavailable links remain
represented without private image metadata. Explicit saves check a revision of
the saved profile and preserve unrelated manual/desktop reference fields.

- Full backend suite: 2,221 passed; 2 existing directory-symlink skips. The new
  character API's 13 focused tests cover persistence, stale writes, bounded inputs,
  pairing/origin checks, idempotent references and hidden/locked/missing policy.
- Final companion backend/publication suite: 81 passed.
- Full frontend suite: 1,568 passed; 3 existing skips.
- Desktop and phone production builds passed in a temporary source copy using
  the existing installed dependencies; the desktop source record matched.
- Temporary phone build and HTTPS Chromium flow passed profile creation, a
  desktop-edit conflict retaining the phone draft, explicit discard/reload,
  saved reference viewing with pinch/zoom, and persistence after page reload.
- The four core tabs remain available; profiles open through More tools.

No LoRA workflows, raw uploads, dependency installation, APK changes or live
activation were added. Real device/provider/GPU acceptance remains separate.

## Folder consolidation record

Checked on October 23, 2026, with the published image-scan refresh fix included.
The move groups 74 existing source files under `mobile-companion/` and keeps
shared workstation dependencies at their existing locations.

| Check | Result |
|---|---|
| Full frontend suite | 1,566 passed; 3 existing skips |
| Full backend suite, temporary data/model/log/catalog paths | 2,201 passed; 2 directory-symlink checks skipped on this Windows account |
| Final source-capture/native publication checks | 23 passed, including historical paths and private-file exclusions |
| Production desktop and phone builds | Passed in an isolated source copy with a fresh lockfile install |
| Phone development serving | Moved entry point and shared desktop component both returned HTTP 200 |
| Android JVM tests and release lint | 15 tests passed; lint completed with 6 warnings and no errors |
| Native adapter Chromium QA | 8 synthetic checks passed |
| Hosted phone-update Chromium QA | Passed pairing, version acknowledgment, draft confirmation, update application and failed-build recovery |
| Documentation | Local links, anchors and relocation map passed |
| Outgoing source/privacy review | Passed; existing Android output files retained matching SHA-256 hashes |

The full backend run initially failed because its temporary log folder had a
custom basename while an existing test expects `logs`. Using the documented
temporary-root layout resolved it without changing application logging. The
relocated tests also share the workstation fixture constants so full-suite
collection works regardless of which test root pytest loads first.

Builds retained existing large-chunk/browser-externalization notices. Backend
checks retained dependency deprecation warnings; Android checks retained SDK and
Gradle/deprecated-API warnings. These checks did not install a new APK, exercise
physical-phone APIs or verify real-provider/GPU inference.

The live desktop, deployed `dist`, installed dependencies, VPN/network settings,
private signing identity and runtime pairing/job databases were not changed for
validation. Runtime activation remains a separately coordinated step. After that
activation, follow the [phone acceptance steps](../README.md#phone-acceptance-after-coordinated-activation).
