# Application review and source history

Reviewed 2026-10-23 (America/Denver).

October 22–23 source/documentation review with isolated application tests. Narrative evidence and retained source snapshots have separate dates. No fresh deployment, physical-phone acceptance or real GPU quality claim.

Current workflow guides are consolidated. Earlier implementation proposals are superseded by current source and the verification record. Automated suites pass with recorded skips; the npm advisory audit remains open.

[Open the local reader](index.html) · [Read history](HISTORY.md) · [Workflow](README.md)

## Validation at this review

- **Frontend** — 1,525 passed; 3 skipped across 188 files (Automated, October 22–23).
  Command: `npm test`
- **Backend** — 2,196 passed; 2 skipped; 26 deprecation warnings (Isolated automated suite, October 22–23).
  Command: `venv\Scripts\python.exe -m pytest (temporary LAW_DATA_DIR, LAW_MODELS_DIR, LAW_LOG_DIR, LAW_IMAGE_MANAGER_DIR)`
- **Media Manager** — 124 Python and 21 Node passed (Automated, October 22–23).
  Command: `npm run test:media`
- **Python compatibility** — No broken requirements (Installed metadata).
  Command: `venv\Scripts\python.exe -m pip check`
- **JavaScript advisories** — Failed: four affected packages; one high, three moderate (Dated registry advisory result).
  Command: `npm audit --json`

These results belong to the dated audit, not to every later snapshot. Future captures do not rerun tests.

## Validation limits

- Physical-phone installation/VPN behavior, fresh Windows setup, live search-provider credentials, real GPU/training/voice quality and controlled performance were not rerun.
- Direct Electron QA attempts produced no result artifact and are not counted as passing.
- Older Android and control fixtures retain their original date and limitations in VERIFICATION.md.

## Findings and change status

P1 = prioritize correctness, recovery or growing-library impact. P2 = measure or plan next. Findings remain proposed unless explicitly marked implemented with dated verification.

### D01 · P1 · Dependency advisory remediation remains open

**Evidence:** October 22–23 npm audit of installed lockfile dependencies.

Vite 6.4.3, Electron 44.4.5, @vitest/mocker 4.1.11 and Vitest 4.1.11 are affected. Passing suites do not make the advisory gate pass.

**Proposed next step:** Review available fixes in a separate dependency change and validate desktop/browser boundaries, desktop/mobile builds and Vitest.

**Acceptance check:** Rerun npm audit and the affected regression checks; report residual findings rather than treating pip check as a vulnerability audit.

**Preserve:** Preserve application behavior, data and platform/security boundaries.

Source: [package.json](../../package.json), [package-lock.json](../../package-lock.json), [docs/development/VERIFICATION.md](../../docs/development/VERIFICATION.md).

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

1. Remediate the recorded dependency advisories.
2. Complete required live-provider, device and GPU acceptance separately from source/fixture checks.

## Metrics for before/after comparisons

- Use matched inputs, hardware and source identity for performance comparisons; historical synthetic measurements do not establish current real-workload speed.
