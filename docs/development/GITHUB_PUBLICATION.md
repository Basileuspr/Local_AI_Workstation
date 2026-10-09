# Publish Application to GitHub

The **Dashboard > GitHub update** card starts compact. Choose **Show GitHub
details** to open its controls and **Hide GitHub details** to fold away the
source list and results. Your display preference is remembered on this PC.
Folding keeps the current file selection and commit-message draft, and running
steps continue. Progress, errors and the published commit link remain visible.

With the details open, choose **Review source changes**.
The first click fetches the configured GitHub repository and captures a source
snapshot. It does not commit or push. Review the file list, select the completed
files, then use the three separate actions:

1. **Validate selected changes** runs the isolated checks and retains the checked
   snapshot. It does not commit or push. Changing the selection requires validation
   again; live source edits are left for a new review.
2. **Commit locally** uses your commit message to commit that validated snapshot
   on a recoverable `codex/github-update-…` branch. It does not push. The original
   development branch and index remain unchanged.
3. **Push to GitHub** sends only that local commit and verifies the destination.
   It checks the prepared files/tree and public parent again. A failed push retains
   the local commit for retry; an already successful push can be verified again
   without creating another commit.

Each step has its own completion status. Saved stage records restore the most
recent reviewed update after a desktop restart; no action starts automatically.
Progress also remains available while switching tabs. To change files after a
local commit, review a new snapshot; the earlier local branch remains recoverable.

Git for Windows must already have permission to push to the configured `origin`.
Use an HTTPS or SSH GitHub origin without credentials embedded in its URL. The
repository's default branch is the destination. GitHub changing after review
stops the push; review a fresh snapshot rather than forcing an overwrite.

Validation uses a fresh checkout based on public Git history, with its own Node
dependencies. It runs frontend, backend and Media Manager tests, npm's advisory
audit, Python dependency consistency and a production build. Python comes from
the app environment; this is not a fresh Python install or a real GPU/voice
quality test. Failed checks stop publication and retain a private log and
checkout for inspection. Successful pushes are verified against GitHub.

Only selected source files and regenerated public review-reader assets are
staged. The development branch, index and user data are preserved. Runtime data,
recordings, models, dependencies, local report/history snapshots, credential
files and binary outputs are excluded. Detected credentials, personal paths and
non-test email addresses block a file. These pattern checks supplement reviewing
the source; they cannot prove that arbitrary source contains no private text.

The offline piano converter's licensed Basic Pitch weights are the single bundled
binary exception. Publication checks their exact size and SHA-256 before capture
and in the outgoing tree; other model weights remain excluded. Regenerated public
review-reader assets are staged explicitly even when local Git excludes hide them.

The button does not infer whether another chat has finished a feature. Select
related files together, or wait until the feature is complete. Missing dependent
source or incompatible selections can fail validation. The button never runs
merely by opening Dashboard, and it never force-pushes or rewrites local history.

Use **Open publication log** for diagnostic output. Snapshots/logs live in the
desktop app's private profile under `github-publications`; generated test media
and failed checkouts can consume disk space. Completed publication checkouts are
removed after remote verification when Windows permits it; logs and reviewed
source snapshots remain local.
