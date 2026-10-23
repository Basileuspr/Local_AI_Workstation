# Application review and source history

[Open the offline reader](index.html) for narrative findings, captured dependencies,
recorded commits and source comparisons. [AUDIT.md](AUDIT.md) and
[HISTORY.md](HISTORY.md) are generated plain-text views.
[Current verification](../development/VERIFICATION.md) owns test evidence and gaps.

## Record and regenerate

After a coherent completed change, capture source/dependency metadata from the
repository root:

```powershell
venv\Scripts\python.exe -B scripts\capture-app-review.py --note "Describe the completed change"
```

This creates an immutable timestamped observation and regenerates the reader.
It does not run tests, infer feature creation dates, read app content/model weights,
change settings or publish. Use the repository venv to record its installed
packages. Do not capture while another editor/session is changing source.

Edit `review.json` to reassess narrative findings. To render existing observations
without adding a capture:

```powershell
venv\Scripts\python.exe -B scripts\capture-app-review.py --render-only
```

A capture does not refresh narrative test claims. Keep narrative review dates,
source-observation times, Git commit dates and deployment dates distinct.
The public reader can contain older observations than its current narrative.

## Build and privacy boundaries

`npm run build` performs a build capture and writes root `build-info.json`,
then emits identity beside the renderer. It changes build output and is not
required merely to edit documentation. `LAW_BUILD_REVIEW_DIR` redirects review
output, not root build identity or dist.

Local observations can contain private source metadata. Do not copy local snapshots
into a public update. The publication workflow regenerates public assets from
approved public observations; inspect outgoing ancestry/files as well as content.

The reader stores source hashes/metadata, not historical source bodies. Use Git
or retained source backups for exact old contents. Comparison proves differences,
not runtime correctness, security or performance.

## Relocated documents

The reader and Markdown generator share
[document-moves.json](../development/document-moves.json).
Update that map when consolidating guides, retaining historical labels and hashes.
Private/retired records without a public owner use null to display plain text
rather than a broken or private link. See the [document map](../development/DOCUMENT_MAP.md).

Public snapshot JSON and benchmark receipts remain dated evidence. Superseded
feature recommendations and test narratives are consolidated into current guides
and verification; they are not presented as an active backlog.
