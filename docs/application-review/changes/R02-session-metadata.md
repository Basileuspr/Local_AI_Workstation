# R02 - Session/image metadata inventory

Implemented and documented: **2026-09-30T23:17:55.880201-06:00** (America/Denver). Benchmark completed: **2026-10-01T05:16:14.312107+00:00**. This is a source implementation; the running desktop was not restarted or rebuilt in place. No user chats, images, backups, models or live dist assets were modified during validation.

[Reader: findings](../index.html#findings) · [History](../HISTORY.md) · [Raw samples and methodology](../benchmarks/session-metadata.json)

Final verification recorded: **2026-09-30T23:24:38.186385-06:00**. The reader shows R02 as implemented, its measured table, and comparison against the preceding source observation.

## Before and after

Before, a summary list parsed every session JSON. Visible and hidden image lists independently parsed those same files and walked all messages; some listing reads also saved missing stable IDs. Generate history requested both image groups separately.

After, all three lists share a small, process-local metadata cache keyed by file mtime, ctime, size and inode. Only new/changed JSON files are parsed. Successful atomic saves invalidate their entry; deletion evicts it; restore saves refresh it. External replacement, removal and repair are detected by file revisions. The inventory stores summaries, image metadata and internal digests, without retaining message bodies or image payloads. Caller mutations cannot alter the cached metadata.

`GET /sessions/images?include_hidden=true` returns visible `images` and `hidden_images` in one request, with `Cache-Control: no-store`. Existing visible-only and `hidden=true` responses remain compatible. Generate reconciliation uses the combined endpoint. Other consumers share the same backend inventory.

Vault policy is read **after** each inventory scan. Public-access decisions are never cached: lock changes immediately filter both groups, damaged vault policy fails closed, and PIN unlock only grants private access. Restoring a private image makes its retained public references eligible again.

If a legacy source has no verifiable content digest (for example an old output URL), its metadata is suppressed while any privacy locks exist. Its source JSON and recoverable references remain unchanged; clearing locks makes that metadata eligible again. The cache never treats an unknown content identity as proven public.

## Measured results

Synthetic chats each contain 40 messages with 1,024 padding characters per message and three blob-reference images; one image is hidden. Before: summary plus two independent image lists. After: summary plus combined image inventory. Exact returned metadata equality was checked.

| Chats | Before (ms) | Cold (ms) | Warm (ms) | Before JSON (MiB) | Cold JSON (MiB) | Warm JSON (bytes) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 169.535 | 88.626 | 24.375 | 12.88 | 4.29 | 0 |
| 1000 | 685.142 | 333.372 | 67.436 | 128.82 | 42.94 | 0 |
| 5000 | 3573.13 | 1675.0 | 320.746 | 644.1 | 214.7 | 0 |

Warm results are medians of five samples. Cold means the application metadata cache was cleared; the Windows disk cache was not flushed. JSON bytes are complete source-file bytes parsed, not measured physical device I/O. Samples exclude HTTP serialization, renderer work and GPU activity. Results are synthetic, not the actual user's retained-library latency. The raw report also records cold/warm timings for each individual list.

Warm requests still enumerate/stat every file and sort/copy returned metadata. Cost therefore still grows with chat/image count, but no longer with total retained conversation bytes on warm reads. A backend restart rebuilds the cache from JSON; there is no persistent sidecar index or cache-dependent data recovery.

## Legacy migration and recovery

List requests never write session JSON, IDs, blobs or migration backups. Missing legacy message/preview IDs are deterministic in memory, so their listed URLs match the IDs persisted by a later selected-chat migration. Existing IDs stay unchanged.

`POST /sessions/metadata/migrate` accepts `{"session_ids": ["chosen-chat-id"]}`, restricted to 1-25 valid selected IDs per request. It does not scan or automatically migrate the library. Opening an individual chat also retains the existing one-chat first-touch migration. Before a migration rewrites the original, its pre-migration JSON is backed up. Chat content and recoverable references remain authoritative in session JSON. The cache does not reclaim blobs or discard trash/backups.

## Verification

- Full backend suite: **1,062 passed**, in temporary data, log, model and pytest directories. Four existing FastAPI lifecycle deprecation warnings remain.
- Full frontend suite: **669 passed across 79 files**. Combined API success, compatibility and failure behavior are covered.
- Scratch production build passed: 248 modules, main JS 919.82 kB / 281.85 kB gzip. Existing bundle-size warning remains. Build output was kept outside live dist.
- Warm-cache rename reparses only the changed chat; append refreshes counts and image metadata.
- Hide/restore switches the correct inventory group without losing chat references. Permanent image removal refreshes metadata while retaining other messages and shared blobs.
- Trash removes the chat from active inventory; restore and cache clearing rebuild its metadata. Recoverable image bytes remain readable.
- External file replacement with preserved mtime, removal, corruption and repair refresh listings without rewriting source files. Malformed image metadata does not hide an otherwise valid chat summary.
- Both inline and blob image digests obey lock changes in visible and hidden lists. A lock applied during a cold rebuild is honored; damaged vault policy rejects warm results.
- Unverifiable legacy source metadata fails closed while locks exist, without erasing its original reference or hiding the chat summary.
- Real vault import/lock/PIN unlock/restore confirms private images stay out of public inventory until restored, including with a warm cache.
- Legacy listing preserves exact original JSON bytes and mtime; IDs/URLs remain stable after cache clearing and bounded migration. The pre-migration backup and original image bytes remain recoverable.
- Invalid/empty/over-limit migration selections are rejected before migration.

## Reproduce safely

From the repository root, run the benchmark with the repository Python. It creates synthetic data in a new temporary directory and sets all application data locations before backend imports. Use a new report filename when retaining a later measurement:

```powershell
.\venv\Scripts\python.exe -B .\scripts\benchmark-session-metadata.py --output .\docs\application-review\benchmarks\session-metadata-NEW-DATE.json
```

The application source must be loaded by a new backend/renderer to use this change. Fully quit Electron from the system tray before rebuilding/relaunching through the normal workflow; a hidden old process can continue serving old behavior. This task did not interrupt the currently running app.

Source snapshots record the entire scoped working tree, including other local edits made since the preceding observation. The R02 source list and this record identify the work attributable to this change; the snapshot's complete file delta is not an R02-only diff.
