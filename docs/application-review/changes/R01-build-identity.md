# R01 - Coordinated release and build identity

Implemented and documented: **2026-09-30T23:51:06.121761-06:00** (America/Denver). Source version: **1.0.1-dev**. This is a local development version. A generated source capture identifies the checkout; it does not certify every preexisting feature or establish a published stable release.

[Reader: identity and dependencies](../index.html#versions) · [Readable release entry](../../../RELEASES.md) · [History](../HISTORY.md) · [Current generated build record](../../../build-info.json)

## Before and after

Before, package.json remained at 1.0.0 despite the September 25 HEAD and extensive uncommitted additions. FastAPI used its default version. Desktop version text, source history and feature reports could not identify the running source state together.

After, package.json and both root package-lock.json version records agree on **1.0.1-dev**. FastAPI explicitly reports that package version. A generated build identity joins version, capture timestamp, shortened source commit, a scoped source/document fingerprint and dirty suffix. Changing uncommitted content produces a different fingerprint even if version and HEAD remain the same.

## One captured record

Root `build-info.json` includes:

- Application version and exact build identifier.
- Full local source commit, separate commit author and commit timestamps.
- Dirty state and full worktree entry count at capture, plus the scoped source-change count.
- Exact capture timestamps in UTC and America/Denver, and the immutable source snapshot ID.
- A fingerprint and normalized hashes for the captured source/document files.
- Host runtime versions, declared/locked/installed direct JavaScript versions, transitive JavaScript lock versions, and key installed Python package versions.
- Date-basis and validation limits. Reported/first-observed feature dates remain in the existing ledger.

The reader's Versions section displays this build identity above the dependency tables. Generated HISTORY.md includes build IDs on dated observations. The production output also contains a public `build-info.json` asset with the portable identity and dependency record; its internal source-file hash map is omitted. Root build-info.json is generated and ignored by Git, while saved source snapshots retain its dated identity.

The dirty flag describes Git's state **at capture**. It is not a claim that a later filesystem or running process still matches that capture. Each snapshot records the entire scoped tree, including other local edits; the R01 source list identifies this change scope.

## Production build workflow

`npm run build` invokes the Vite configuration, which uses the project Python environment (or `LAW_PYTHON`) to run the source capture with `--build`. The capture reads source, local Git metadata and dependency metadata; it does not import the app, access chat/model data, run inference, install packages or modify Git ancestry.

The capture creates the immutable source observation and shared identity before compilation. Vite embeds the identifier in the renderer and verifies the recorded source files and build ID again before emitting the bundle. Source drift or an overlapping capture stops the build. Generated identity and rendered history files are excluded from source hashes to avoid recursive identities.

Capturing a build requires Git and the configured Python environment. A running captured build does not require Git; the desktop/backend loaders read portable JSON. Missing or invalid metadata is explicitly unrecorded. A package-version mismatch or changed/missing recorded source file is labeled, preserving the identifier of the saved capture rather than silently inventing a new one.

The runtime check covers the recorded file inventory, not uncaptured new files or a live Git status refresh. The next production build captures the current file inventory and dirty state again. Build metadata is provenance, not cryptographic authenticity or behavior certification.

## Desktop and API agreement

The Electron process and backend each retain the identity they loaded at startup. A later capture cannot relabel an already-running process. The renderer embeds its own identity at build time, so an old compiled bundle cannot inherit a newer backend's identifier.

- Dashboard > App software specs shows the app version and build identifier. Preview/copy/export includes source commit, capture time, dirty state and source snapshot even when only a dependency section is selected.
- Desktop IPC `dashboard:software-runtime` includes its loaded build record with the existing Electron/Chromium/Node/V8 runtime versions.
- `GET /version` returns the backend's process-loaded identity with `Cache-Control: no-store` under the existing session guard.
- OpenAPI `info.version` is the explicit package version.
- `/health` preserves its existing `{"status":"ok"}` response and launch header, adding `X-LAW-Version` and `X-LAW-Build`.
- Software specs report differing desktop/renderer/backend IDs and changed recorded source. Fully rebuild/relaunch when those notices appear. Package version at process load and version in the saved capture remain separately visible on mismatch.

The current running desktop was not interrupted or rebuilt in place by this task. Scratch builds and isolated API checks verify new source; the user must load the new build through the normal full-relaunch workflow.

## Verification

- Full backend suite: **1,077 passed**, with four existing lifecycle deprecation warnings. Data/log/model paths and pytest storage were redirected to new temporary directories before imports.
- Full frontend suite: **681 passed across 82 files**.
- Targeted backend/API/software-inventory checks: **60 passed**. Actual Python and Node identity loaders agree on the same portable fixture without Git in its source folder.
- Dirty-content changes, recorded-file edit/removal, package-version mismatch and missing/corrupt records have explicit behavior. Existing IDs are not replaced with invented identities during drift.
- API version metadata, OpenAPI version, health identity headers and software inventory use the process identity; the health response contract stays compatible.
- Frontend checks include provenance with selected dependency groups and visible stale renderer/desktop notices.
- Scratch production build passed: it captures before compilation, emits portable metadata and embeds the renderer identity. Live dist assets and app data were preserved. The existing main-bundle warning remains.
- The completed capture is checked for agreement among root metadata, snapshot, emitted artifact, fresh API metadata, desktop loader and reader, with the local source HEAD unchanged.

## Date and release meanings

The September 25 commit date is recorded Git metadata. The September 28 feature date in PROJECT_STATUS.md is a reported review/addition date. The September 30 source observations establish that preexisting uncommitted source was present by those times. None establishes original creation time for those uncommitted features.

The new development version records this follow-up. It does not assign today's creation date to older additions. The local release ledger documents the next reviewed stable-release steps; public-repository parity and publication require a separate review. No commit, branch, private ancestry or remote repository was rewritten.
