# Coordinator

Open **Coordinator** in the main navigation beside Dashboard, Prompt Queue,
Functions and Info Center. Choose **Coding**, **Research & Knowledge**, or
**Media Librarian** from Harness. Model selection is independent for each harness.
Dashboard, Functions, Info Center and Prompt Queue are also available in its header.

Switching harnesses preserves drafts and submitted work. **All saved tasks** opens
history across all three harnesses. Each task retains its original harness/version;
changing the selector does not change the tools or permissions of a running task.
The existing local inference queue controls GPU access.

## Coding

The [Coding guide](CODING_COORDINATOR.md) covers native project selection, source
edits, Verification Manager, profiles, approvals, checks and review. Existing tasks
remain in their original storage. Old Coding Coordinator routes, shortcuts and
pins continue to open Coordinator. Direct legacy navigation selects Coding.

Task/model/context drafts survive a reload. A fresh desktop launch requires native
project selection again; persisted verification profiles and grants do not grant
arbitrary project access. Coding retains its existing Pause/Resume/Stop behavior.

## Research & Knowledge

Describe a question, select an installed local model and optionally supply up to
six public source URLs. Select a page budget from one to six. **Start research**
uses the search provider configured in [Web](../development/WEB_SYSTEM.md), bounded
public retrieval and the existing source-ID/quote/support checks. Model output
and retrieved text remain untrusted; these checks do not guarantee factual truth.

The result shows a cited answer, source links, retrieval/publication dates and
partial coverage. This harness deliberately retains the answer, provenance and
captured source documents in its private saved task, including after app restart.
The separate Web workspace's temporary research lifecycle is unchanged.

**Save S… to Knowledge** explicitly indexes that captured source through the
existing local embedding queue. It saves evidence with provenance, not the model's
generated answer. The receipt distinguishes indexing from an existing duplicate.
Opening the harness or starting research never automatically indexes Knowledge.

## Media Librarian

**Browse registered media**, filter by source/metadata and choose up to 24 items.
Describe an organization goal and select an installed local text model.
**Plan media organization** reads registered names, captions, tags, categories
and recorded hashes. It does not analyze image pixels or video frames.

Review each proposed category, additional tags and reason. Select proposals and
choose **Apply selected metadata**. Existing tags and other metadata are retained;
the proposed category replaces the current category. A changed record rejects a
stale proposal. Actual writes produce receipts; applied proposals cannot replay.
Partial failure preserves receipts for operations that completed.

Duplicate candidates share a recorded hash within the selected items. This is not
a new whole-library scan or a file-deletion tool. Use the existing library tools
for broader duplicate inspection.

For file organization, select items from the saved task, choose Copy or Move and a
configured destination preset, then **Prepare transfer plan**. Configure presets
in Review. Inspect the displayed source/destination entries before confirming the
exact plan. The existing workflow verifies source state, preserves collisions,
consumes the plan once, and retains transfer receipts. Media Manager videos keep
their own transfer workflow. Review exposes history and eligible move undo.

## Persistence and recovery

Research and media runs are stored beneath the local app-data `coordinator`
directory, separate from `coding-coordinator`. They include private task content,
captured evidence, metadata proposals and operation receipts. Up to 100 runs are
retained. **Remove saved task** removes its Coordinator evidence/history; it does
not remove Knowledge documents, transferred files or the review workflow's receipts.
App-data backup/reset owns these directories through its Other app data section.

Research/media planning supports Stop, not pause/resume. After interruption, inspect
the saved state and start a fresh task. Startup never replays uncertain operations.
Stopping retains completed work; it does not undo it. Maintenance is blocked while
a harness or file operation is active. Drafts live in the local browser profile.

## Development

The shared workspace is `src/components/Coordinator.jsx`; bounded research/media
adapters and durable state are in `backend/services/coordinator_harnesses.py` and
`coordinator.py`. Coding keeps its existing native control boundary. The model
cannot switch harnesses, approve its own actions, select arbitrary filesystem
paths, or execute arbitrary endpoints. Tool-catalog entries advertise the UI,
not these mutating controls as general model tools.

Run `tests/backend/test_coordinator.py` with isolated runtime paths, the frontend
Coordinator/navigation/help checks and `node scripts/qa-coordinator.cjs`. Existing
coding, research and media workflow suites exercise their underlying contracts.
See [verification](../development/VERIFICATION.md) for observed tests and limits.
