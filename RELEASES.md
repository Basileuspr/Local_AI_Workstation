# Local release records

## Application update checks

Check for Updates uses the published project version in
[GitHub's package manifest](https://raw.githubusercontent.com/Basileuspr/Local_AI_Workstation/main/package.json)
by default. `LAW_UPDATE_MANIFEST_URL` can select another HTTPS JSON version feed;
an explicitly empty value disables checks. Offline or invalid responses report
Unable to check. Nothing is installed automatically.

This is a version check for the source distribution. Development commits with
the same version are not detected. Advance the version in `package.json` and
`package-lock.json` when publishing a new reviewed version so the checker can
announce it. A GitHub commit alone is not a new version or packaged release.

## 1.0.1-dev - development build identity

Recorded during the September 30, 2026 application-review follow-up. This is a
local development version. It identifies captured source and is not a published
stable release or a certification of all preexisting features.

- R01 coordinates the manifest/lockfile version, desktop software specs,
  renderer identity and backend API metadata. Production builds save a shared
  `build-info.json`, emit that metadata beside the renderer, and add an immutable
  source snapshot to the existing review history.
- R02 adds a shared revision-keyed session/image metadata cache, one combined
  Generate-history inventory request, bounded legacy migration and current lock
  filtering. Its synthetic measurements and preservation checks are recorded
  separately in the [R02 change record](docs/application-review/changes/R02-session-metadata.md).
- R03 (October 1) rejects stale whole-chat replacements, makes rename/compaction
  metadata-only, and coordinates frontend revision/conflict handling. Additive
  replies remain independently durable. See the dated [R03 contract and checks](docs/application-review/changes/R03-session-revisions.md).

The current generated [build record](build-info.json) contains the full source
commit, dirty state at capture, UTC/local capture timestamps, source fingerprint,
snapshot ID, declared/locked/installed JavaScript dependencies and key installed
Python versions. The [local reader](docs/application-review/index.html#versions)
shows the same identity with dependency tables and history comparisons.

Read the [R01 implementation record](docs/application-review/changes/R01-build-identity.md)
for API fields, mismatch behavior, checks and the build workflow.

## Date meanings

- **Commit author/commit date:** recorded Git metadata for the local source
  commit. The current baseline commit is from September 25, 2026.
- **Reported feature date:** a statement such as the September 28 additions in
  `docs/archive/PROJECT_STATUS.md`. It is not proof of original creation time.
- **First observed:** a saved source snapshot shows that a feature's source was
  present by that capture time. Preexisting uncommitted feature creation times
  remain unknown.
- **Build capture:** the precise timestamp associated with a generated build
  identity. It establishes observed source, not deployment or publication.

The existing dated feature ledger remains in
[HISTORY.md](docs/application-review/HISTORY.md). These records identify this
local checkout. Public-repository parity requires a separate review.

## Producing the next reviewed release

1. Coordinate `package.json` and both root version fields in `package-lock.json`.
   Choose a stable version only after the intended release scope is reviewed.
2. Update this release entry and the dated feature/verification ledger. Keep
   reported dates separate from commit and observation dates.
3. Run the relevant isolated checks, then `npm run build`. Vite captures a fresh
   identity before compilation; a failed source capture stops the build.
4. Inspect the generated build record and renderer asset. Fully quit/relaunch
   Electron so the desktop, backend and renderer load the intended build.
5. In Dashboard's software specs, confirm the component build identifiers agree.
   `/version`, OpenAPI `info.version` and `/health` identity headers provide API
   evidence. Review packaging/publication separately when requested.

Build capture requires Git and the project Python environment (or `LAW_PYTHON`).
Running a captured build does not require Git. Generated identity/report assets
do not rewrite Git ancestry or establish remote equivalence.
