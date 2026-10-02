# R03 - Reject stale chat histories

Implemented and documented: **2026-10-01T00:10:04-06:00** (America/Denver).
Local development version: **1.0.1-dev**. The next production build captures a
new identifier for this source. This date records this follow-up, not the
creation date of older uncommitted features.

[History reader](../index.html#findings) · [Release ledger](../../../RELEASES.md)

## Before and after

Previously, PUT /sessions/{id} and update_session replaced all messages without
checking whether a different client had saved newer content. Serialized atomic
writes protected files from truncation but allowed stale complete histories.
Rename and manual compaction still submitted complete histories. Automatic
compaction could attach an outdated summary to a reply append.

Now, full-history replacement requires the exact revision returned when the
caller loaded that history. Revision comparison and the atomic save run under
the existing single-backend session lock. Every successful save assigns a fresh
opaque revision, including image changes, migration and trash restore. Restore
cannot make a pre-deletion revision current again. Failed atomic writes do not
advance the persisted revision.

Legacy sessions without revisions receive a deterministic identity on individual
read without rewriting otherwise valid history. Existing per-chat image/ID
migration and its backup behavior remain; there is no bulk history migration.

## Coordinated contract

| Operation | Contract | Stale behavior |
| --- | --- | --- |
| GET /sessions/{id} | Full session includes revision; frontend bypasses its HTTP cache | Load the authoritative view before an explicit retry |
| PUT /sessions/{id} | messages plus expected_revision matching the loaded view | 409 on mismatch; 428 when omitted; history preserved |
| POST /sessions/{id}/messages/append | Stable message IDs; new IDs merge into the current server history | Updating an existing ID to different content requires a matching revision; identical content does not replace another turn |
| PATCH /sessions/{id}/metadata | Explicit title/model or summary fields; messages rejected | Rename/model updates preserve messages; summary/count changes require a matching revision |

Conflict responses contain detail.code, detail.message and detail.current_revision.
The frontend preserves these fields, displays the reload instruction, and does
not automatically retry a replacement or merge summaries. Missing destinations
remain 404. Older replacement callers must update their contract: omitting a
revision no longer authorizes replacement. The service enforces this too, so a
direct Python caller cannot bypass the route's check.

Metadata responses also include previous_revision, without storing that response
field in session JSON. A delayed rename updates the active title without copying
a newer server summary/revision onto an older local history. Compaction results
apply to local state only when their destination and starting revision still
match. Navigation cannot apply a delayed compaction to another chat.

## Frontend and bridge changes

- Header rename uses the metadata endpoint and guards its original destination.
- App manual compaction saves summary metadata only, using the starting revision,
  and changes local memory after the save succeeds.
- InputBar saves each submitted turn and completed reply independently with
  stable IDs. Automatic summaries use the revision of the history they summarized.
  A summary conflict is surfaced separately; it cannot discard an appended reply.
- Session loads and authoritative responses carry revisions into the store.
- Web-source chat creation appends its source message and changes its title
  separately; it does not submit a whole-history replacement.
- Bridge result saves append stable job-derived IDs. Recovery of a partially
  recorded save skips existing IDs, preserving later edits to those messages.
- Existing replacement tests now supply explicitly loaded revisions; no
  permissive compatibility bypass was added.

## Acceptance evidence

Disposable HTTP clients loaded the same starting revision. The first replacement
succeeded; the stale replacement returned 409 and left the persisted JSON bytes
unchanged. Both concurrent appended messages then survived. Additional checks
cover missing revisions, disallowed histories on the metadata route, stale
summaries, valid compaction preserving newer messages/title, stable-ID update
conflicts, restored revision invalidation, retained image references, legacy
read-only identity, and delayed metadata after navigation or local revision change.

Full backend suite: **1,089 passed**, with four existing lifecycle deprecation
warnings. Full frontend suite: **688 passed across 84 files**. After the final
metadata-response guard, **33 backend revision/bridge checks** and **4 frontend
revision checks** passed again. A scratch production build and updated history
reader are checked after saving this record. The existing bundle-size warning
remains.

These are automated store/HTTP/reducer checks with synthetic clients, not live
multi-device, model-inference or GPU validation. Data/log/model paths were set to
temporary folders before backend imports. Live chat history, model storage and
running desktop/dist assets were not modified or restarted.

## Limits and preservation

Concurrency protection applies to the supported single backend process that owns
the application data. It is not an interprocess database transaction or an editor
watcher: out-of-band tools must not modify active JSON while retaining its old
revision. Captured build metadata remains source provenance, not certification.

Summaries are never silently combined or reassigned to another history. Rejected
saves retain the newer authoritative JSON and recoverable chat/image references.
The next explicit reload lets the user review current content before retrying.
No private Git ancestry or remote/public repository was changed.
