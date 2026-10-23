# Application review and source history

Reviewed 2026-10-23 (America/Denver).

October 22–23 source/documentation review and October 23 dependency remediation with isolated tests/builds. Narrative evidence and retained source snapshots have separate dates. No deployment, physical-phone acceptance or real GPU quality claim.

Current workflow guides are consolidated. The four previously affected npm packages are patched; the dated advisory audit reports zero vulnerabilities. Automated suites pass with recorded skips. Earlier proposals are superseded by current source and the verification record.

[Open the local reader](index.html) · [Read history](HISTORY.md) · [Workflow](README.md)

## Validation at this review

- **Frontend** — 1,538 passed; 3 skipped across 192 files (Isolated lockfile installation, October 23).
  Command: `npm test`
- **Backend** — 2,198 passed; 2 skipped; 26 deprecation warnings (Normalized isolated paths, October 23).
  Command: `venv\Scripts\python.exe -m pytest (temporary LAW_DATA_DIR, LAW_MODELS_DIR, LAW_LOG_DIR, LAW_IMAGE_MANAGER_DIR)`
- **Media Manager** — 124 Python and 21 Node passed (Isolated automated checks, October 23).
  Command: `npm run test:media`
- **Python compatibility** — No broken requirements (Installed metadata).
  Command: `venv\Scripts\python.exe -m pip check`
- **JavaScript advisories** — Passed: zero vulnerabilities (Default and lockfile-only audits in the fresh validation install, October 23).
  Command: `npm audit --json; npm audit --package-lock-only --json`
- **Production builds** — Desktop and mobile passed; existing desktop chunk-size warning (Disposable build output, October 23).
  Command: `npm run build`
- **Electron browser boundaries** — Passed on Electron 44.5.0, including separate-process profile/restart and authenticated-media checks (Isolated fixture with hidden Electron windows, October 23).
  Command: `node scripts/qa-browser-foundation.cjs`

These results belong to the dated audit, not to every later snapshot. Future captures do not rerun tests.

## Validation limits

- Physical-phone installation/VPN behavior, fresh Windows setup, live search-provider credentials, real GPU/training/voice quality and controlled performance were not rerun.
- The separate full desktop startup smoke launch was unavailable. Successful Electron checks used isolated browser fixtures; the normal app was not restarted or redeployed.
- Older Android and control fixtures retain their original date and limitations in VERIFICATION.md.

## Findings and change status

P1 = prioritize correctness, recovery or growing-library impact. P2 = measure or plan next. Findings remain proposed unless explicitly marked implemented with dated verification.

### D01 · P1 · Dependency advisory remediation

**Evidence:** October 23 default and lockfile-only npm audits in a fresh validation install and isolated regression checks.

The initial audit affected Vite 6.4.3, Electron 44.4.5, @vitest/mocker 4.1.11 and Vitest 4.1.11. The patched lockfile reports zero vulnerabilities.

**Proposed next step:** Keep advisory checks separate from test results and rerun both when updating dependencies.

**Acceptance check:** Run npm audit, a clean lockfile installation, affected suites, desktop/mobile builds and Electron boundary fixtures.

**Preserve:** Preserve application behavior, data and platform/security boundaries.

Source: [package.json](../../package.json), [package-lock.json](../../package-lock.json), [docs/development/VERIFICATION.md](../../docs/development/VERIFICATION.md).

**Status:** Implemented · 2026-10-23

**Completed change:** Updated Electron to 44.5.0, Vite to 6.4.4, and Vitest/@vitest/mocker to 4.1.12 without changing major versions.

**Verification result:** Zero npm vulnerabilities; 1,538 frontend and 2,198 backend tests passed with recorded skips, 145 media checks passed, builds and Electron browser fixtures passed. Full desktop startup and live device/provider/GPU acceptance remain separate.

### D02 · P2 · Consolidated current documentation

**Evidence:** Source/control and documentation comparison, October 23.

Older guides contradicted current response limits, startup/session persistence, close behavior, bundled media, image-plan confirmation, browser profiles and model tool execution.

**Proposed next step:** Maintain one workflow guide per topic and one dated verification record.

**Acceptance check:** Check relative links/anchors, retained historical snapshot identity and the generated reader.

**Preserve:** Preserve original snapshots, private handoffs and external app data.

Source: [docs/README.md](../../docs/README.md), [docs/development/VERIFICATION.md](../../docs/development/VERIFICATION.md), [docs/development/document-moves.json](../../docs/development/document-moves.json).

**Status:** Implemented · 2026-10-23

**Completed change:** Merged current usage/contracts, removed superseded public guides and introduced one relocation map shared by generated links.

**Verification result:** Application suite results are listed above; documentation/capture validation is recorded with this update.

## Already implemented

- Revision-checked session updates and shared session/image metadata.
- Portable source/build identity and explicit interrupted-job recovery.
- Opt-in reviewed local model tools; separate desktop, Browser, mobile and public-web boundaries.

## Suggested order

1. Repeat advisory checks for subsequent dependency changes.
2. Complete required live-provider, device and GPU acceptance separately from source/fixture checks.

## Metrics for before/after comparisons

- Use matched inputs, hardware and source identity for performance comparisons; historical synthetic measurements do not establish current real-workload speed.
