# Architecture reference

The [root architecture map](../../ARCHITECTURE.md) locates source ownership.
This reference describes the current boundaries; source and focused tests remain
the implementation authority. It replaces completed phase plans and old
application-awareness inventories.

## Processes and admission

Electron owns native dialogs, guarded preload/IPC, browser views, desktop lifecycle
and its managed FastAPI process. React uses the supplied backend port/session
credential. FastAPI services own durable app state and coordinate Ollama and local
generation runtimes.

The ordinary API is loopback-bound with Host, Origin and session checks.
Health is the intentionally public readiness endpoint. Native-only capabilities
also require the desktop capability. The opt-in PC bridge and mobile gateway are
separate services, not permission to expose the normal API.

CPU work lanes and shared GPU admission coordinate chat, vision, embeddings,
generation, workflow processing and training. Cancellation retains ownership until
runtime cleanup; switching UI panes is not cancellation. Backend-owned accepted
jobs can outlive a client connection, but interrupted work is not universally
replayed after backend restart.

## Persistence ownership

| Owner | Contents and boundary |
|---|---|
| Sessions | Chat history, attachments and revision-checked updates |
| Memory/settings | Explicit durable preferences/context, separate from conversation history |
| Knowledge | Explicitly ingested text, embeddings and graph relationships |
| Managed libraries | New media/documents in registered folders; older locations remain readable |
| Image Manager | Independent external-image catalog, reviewed file plans and Trash |
| Media Manager | Separate module, reports and media-operation records |
| Browser | Isolated account profiles and bounded workflow checkpoints/media |
| Web system | Crawl metadata, optional latest-content storage and temporary research |
| Testing Lab | Private `evaluations/history.sqlite3`: immutable suites, response evidence, human reviews and finite local schedules; text-only inference shares the GPU queue |
| Native companion | Phone connection settings; uses desktop-owned session/gallery services |

Use the owning service for mutations. Session revisions prevent stale history
replacement; a client must reconcile a conflict rather than overwrite newer work.
File plans revalidate source identity and destinations at execution.
Vault checks apply to protected sources and eligible derived/duplicate references,
not only to the gallery’s visible rows.

App backup/reset does not have the same scope as deleting external files.
See [storage](../workspace/STORAGE_AND_BACKUP.md) before changing migrations,
libraries, reset or import.

## Model inputs and tools

Chat assembles selected history, roleplay, memory, Knowledge and attachments under
the model’s real context budget. Response/thinking limits are shared and can be
reduced by remaining context. Capability detection is not a successful inference
test; optional runtimes/models remain explicit installations.

[Tool discovery and execution](TOOL_REGISTRY.md) distinguish descriptions,
read calls and reviewed actions. Local model tool use is opt-in. Models receive
validated contracts, not general shell/filesystem authority.

[Browser](BROWSER.md), [public web retrieval](WEB_SYSTEM.md) and
[Reels Analyzer](REELS_ANALYZER.md) have separate trust and data-lifetime contracts.
Untrusted content is source material, not permission to run embedded instructions.

## Development changes

Check dependencies first: map UI, backend route/service, storage owner, shared
queue and native boundary before editing. Reuse existing validation and mutation
paths. Update a touched Info bubble when workflow behavior changes.

Tests use isolated runtime directories. Source/build metadata proves identity,
not runtime/GPU quality. [Development](DEVELOPMENT.md) defines synchronization,
validation and publication; [verification](VERIFICATION.md) records dated evidence.
