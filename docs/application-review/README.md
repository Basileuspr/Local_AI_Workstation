# Application review and change history

Open **[the local reader](index.html)** for the audit, searchable history,
dependency inventory and change comparison. It works offline without a server,
account, external scripts or copying text into a chat. Reopen/reload it after
refreshing the records. This reader is a repository document, not a new tab
inside the workstation application.

The equivalent plain documents are [AUDIT.md](AUDIT.md) and
[HISTORY.md](HISTORY.md). [review.json](review.json) is the editable audit source;
the Markdown files and HTML reader are generated from it and the saved snapshots.

R02's completed session metadata change has a [before/after record](changes/R02-session-metadata.md).
Its implementation status, measured table and checks also appear inside the
reader's R02 finding. Search for `R02` or `Implemented` to find it quickly.

R01's [build identity record](changes/R01-build-identity.md) explains the coordinated
development version and portable metadata. The reader's Versions section shows
the exact captured identifier, commit, dirty state, timestamps and dependencies.
`npm run build` creates a fresh source snapshot and generated root `build-info.json`
before compilation, then emits build metadata beside the renderer. This uses
the project Python environment or `LAW_PYTHON`; source capture requires Git.

## Record a later change

After finishing a meaningful change, run from the repository root:

```powershell
.\venv\Scripts\python.exe -B .\scripts\capture-app-review.py --note "Describe the completed change"
```

Then open the reader's **Compare changes** section and select the earlier and
later observations. It shows added, changed and removed files, groups them by
application area, and lists application/dependency version changes. The first
comparison includes transitive package-lock versions when both records contain
that metadata; older snapshots are not backfilled with invented version data. The first
comparison is the committed HEAD source versus the current uncommitted source.
That immediately makes the existing work visible; it does not pretend the
uncommitted features were added on the audit date.

Each observation creates a new timestamped JSON file in `snapshots/`; older
snapshots are not overwritten. The command updates only this documentation
folder. It does not import the app, run inference, read chat/model data, change
settings, install packages, commit, push or rewrite Git history. Run it after
editors/other agents finish changing the source so the capture is coherent.

Use the repo venv to capture its actual Python packages. Node metadata is read
from the manifest, lockfile and installed packages. This records the existing
environment; it is not a fresh-install compatibility test. The source inventory
includes scoped code, tests, scripts and root project Markdown; it excludes
runtime data, models, caches, logs, secrets and private Git remotes. Historical
source contents are hashed for the HEAD baseline and not copied into reports.

## Keep the narrative useful

For a new feature or repair, update `review.json` with a plain-language entry:
what changed, why, the affected files, exact date and its basis, and what was
actually checked. Mark proposals, implemented changes, mocked tests and real
runtime evidence separately. Give each new `feature_observations` entry its own
`observed_at` timestamp with timezone, rather than reusing the first audit date.
An omitted timestamp displays as unrecorded. Record a source snapshot after the change.

To regenerate the reader after editing the narrative without capturing another
source observation:

```powershell
.\venv\Scripts\python.exe -B .\scripts\capture-app-review.py --render-only
```

Capturing a snapshot does **not** rerun tests or update the dated audit's validation
claims. Review findings remain attached to the source inspected on September 30,
2026 until someone explicitly reinspects them. A newer snapshot may contain
changes that have not been assessed. The reader labels that distinction.
An implemented finding must carry `status`, `implemented_at`, `implementation`
and `verification_result`; the original observation/proposal remains available
for comparison. Link its detailed record with `result_document`, and optionally
embed a measured table with `benchmark` so it is readable in the same view.

## Dates and comparisons

- **Committed:** Git's recorded author and commit timestamps, with the commit ID
  and changed source paths. These are not deployment dates.
- **Reported:** a dated project-status entry; useful context, but not independent
  proof of an implementation or a test result.
- **First observed:** the precise source-capture time in America/Denver and UTC.
  The original introduction time of preexisting uncommitted code remains unknown.
- **Proposed:** audit recommendations; they have not been implemented by this review.

The current source reports `1.0.1-dev`. Its shared build identifier is generated
from a fresh capture, source commit, source/document fingerprint and dirty state.
Older observations retain their original versions and may predate build identities.
File comparisons normalize
CRLF/LF line endings; snapshots also retain raw SHA-256, byte count and line count.
Hash differences identify changed source, not behavioral correctness. Committed
baseline dependency comparisons use declared/locked versions only; they do not
claim an installed Python environment for a historical commit.

For exact line-level code comparison when desired, Git remains available locally:

```powershell
git log --date=iso-strict --oneline
git diff HEAD -- src backend electron
```

The reader contains metadata, summaries and source links, not saved historical
file bodies. Exact diffs of two uncommitted observations require retained Git
commits or separate source backups. The snapshot history continues only when the
capture command is run; no background automation was installed.

Completed follow-up: [R03 session revisions, conflict contract and preservation checks](changes/R03-session-revisions.md).
