# Internet access and data scraping

Inspection and first implementation: September 7, 2026 (America/Denver).

## Recommendation and delivered scope

Add deliberate public-source imports to the existing local chat pipeline. Keep network fetching in FastAPI, and keep inference, source storage, and conversations on the workstation. Begin with reviewed public sources, then extend coverage behind the same request scheduler and provenance model.

In Chat, expand **Internet Â· Import a public page**, enter a supported HTTPS URL, select **Import page**, review the preview, and select **Open new chat with source**. Ask a question in that chat using the existing composer and selected local model.

This version supports arbitrary public `https://` pages, including query parameters, fragments and ordinary redirects. Wikipedia keeps a richer adapter that returns article text and a revision id. It reads one selected page per import; it does not recursively crawl, search the entire internet, sign in, execute website JavaScript, or let model-generated instructions initiate network requests. Those are distinct expansion decisions, not implied by an imported URL.

## Current project state, verified against source

The checkout is `baseline/v1.0.0-portable`, HEAD `6c46a0e` (`feat: prepare portable workstation with image workflows and LoRA`). It already contained uncommitted image-generation, LoRA, progress UI, training, and test changes. Those were preserved. No commit, push, history rewrite, or existing-data cleanup was performed.

| Existing area | Current implementation and relevance |
|---|---|
| Desktop shell | `electron/main.js`: Electron starts/reuses FastAPI on loopback, negotiates its port, and passes it to the renderer. Closing hides the app; exiting is required to load backend changes. |
| Active UI | React/Vite in `src/`; pane state remains mounted. `dist/` is generated output; `frontend/index.html` is the legacy fallback. |
| Chat | `src/components/InputBar.jsx`, `src/api.js`, `backend/main.py`: SSE streaming from local Ollama, model controls, durable memory, rolling context compaction, and request-ID cancellation. There is no general model tool-execution engine. |
| Direct document import | `src/useChatUploads.js`, `backend/routes/files.py`, `backend/services/file_parser.py`: documents become chat messages. Both existing attachment surfaces remain. PDF text extraction now includes a local vision OCR fallback under GPU coordination; the older architecture documents predate this. |
| Knowledge base | `backend/services/knowledge_base.py`: text chunks â†’ local Ollama embeddings â†’ persistent Chroma collection â†’ query excerpts injected into chat. Metadata is currently filename/chunk based. |
| Sessions | `backend/routes/sessions.py`, `backend/services/session_store.py`: session JSON is authoritative for conversations. Blob storage supports images; trash/recovery is separate. SQLite stores durable memories and a secondary message log. |
| Image generation | Local Diffusers/SDXL, model discovery, prompt-token handling, optional adapters, generation progress, cancellation, output persistence. |
| LoRA | Dataset projects, local vision analysis, captions, preflight, subprocess training, adapter/completion outputs, and progress UI. The dirty tree contains active improvements here. |
| GPU scheduling | `backend/services/gpu_coordination.py` is now shared by participating image/training/OCR operations. The earlier handoff's missing-shared-lock finding is outdated. Web extraction uses CPU/network only. |
| Image workflows | Local execution supports SDXL txt2img/img2img/inpaint, Ollama vision and CPU resizing through the shared queue. Structured iterative scenes and reviewed frame history are available; see `IMAGE_WORKFLOWS.md` and `ROADMAP_SEGMENTS_4_6.md`. |
| Other tools | Prompt Index, conversation export, memory management, runtime status and Reset/Unload, application logging. |
| Dependencies | Existing `httpx`, FastAPI, Python standard library, React, Vitest, pytest, and Vite are sufficient for the first version. No new package or cloud API dependency was installed. |

The inspection covered architecture/handoff documents, tracked state, active source and test inventory, relevant pipeline implementations, dependencies, desktop startup, and live runtime status. It did not inspect personal conversation contents or retrain/run the GPU image pipelines as part of this feature.

## Why use direct chat snapshots first

The existing direct-document path already feeds text into local chat and persists it with the session. Web import uses that established pattern, adding explicit URL, retrieval time, attribution, revision when available, and a content hash.

The current Chroma path is not yet a suitable web-source authority: document IDs derive from filenames, replacement deletes old chunks before new embeddings finish, and retrieval does not carry URL/revision metadata. Quietly importing web data there would introduce collisions, weak citations, and replacement risk. Extend that path deliberately in the second phase.

The first version saves at most 80,000 extracted characters per cached page and copies at most 6,000 into a new chat. The chat explicitly labels an excerpt when truncated. The full cached extraction is not automatically searchable by the model. Session text remains usable without the network or cache. Existing rolling compaction still applies to long conversations.

## Request policy implemented

These are conservative application defaults, not promises of a site's permitted rate:

| Control | Behavior |
|---|---|
| User initiation | No website request on app launch, page entry, chat questions, or model output. Import is an explicit action. Local UI status polling does not contact websites. |
| Concurrency | One active import and one outgoing HTTP request at a time in the app backend. |
| Spacing | At least 10 seconds from completion of one request to starting the next; longer robots delays take precedence. |
| Hourly budget | 30 requests per rolling hour across the supported sources, counting robots requests and failed HTTP attempts. |
| Persistence | Request timestamps, next eligible time, and cooldown survive backend restart in `data/web/limits.json`. An unreadable limits file pauses fetching. |
| Source cache | Successful URL snapshots are reused for 24 hours; fragments do not create duplicate imports. Maximum 200 cached URLs; new imports stop when full. |
| Identity | Descriptive `LocalAIWorkstation/1.0` User-Agent with the project repository URL. No browser impersonation. |
| Robots | Every HTML fetch checks the origin's robots.txt before the page and honors Disallow, Crawl-delay and request-rate spacing, cached 24 hours per origin. A 404 or unreachable robots response is treated as absent; a refusal, cooldown or budget stop still surfaces. |
| Wikipedia | Uses the documented public read-only MediaWiki Action API with `maxlag=5`, article text and revision metadata. This adapter follows API policy; it does not reinterpret HTML robots exclusions as API authorization. |
| Throttling | 429/503 produces a persisted pause, respecting Retry-After seconds or HTTP dates, with a 60-second minimum. No automatic retry. API errors also stop with a pause. |
| Denial | 401/403 stops access and pauses requests for an hour. No alternate hostname, proxy, credential, CAPTCHA, or alternate-endpoint workaround. |
| Download bounds | 5 MB decoded response limit, 35-second request deadline, 240-second import deadline. Only HTML, XHTML and plain text are accepted; other content types are reported, not imported. |
| Stop | Cancels the asyncio task, aborts the active HTTP operation or delay, clears active state, and avoids saving partial text. UI reload can reconnect to an active backend job. |

It is impossible to guarantee a website will not classify automated access as a bot. The objective is identifiable, low-load, policy-compatible automation. Rate limits are enforced in the application's normal single backend; multiple independently launched backends sharing one data directory are not a supported deployment mode.

## Network and content boundaries

- Any public `https://` host and port. Query parameters and fragments are accepted; the fragment is dropped because it never reaches a server and would only split the cache. Rejected without a request: every non-HTTPS scheme, embedded credentials, `localhost`, single-label and internal-suffix names, and literal private, loopback, link-local, multicast, reserved, IPv4-mapped and NAT64 addresses.
- Up to 5 redirects are followed. Every hop is re-validated through the same gate and re-resolved before it is contacted, so a public first hop cannot redirect into a private destination. Loops and overlong chains stop with a named error.
- DNS must resolve exclusively to public IPs. The checked IP is used for the connection, retaining the original hostname for TLS SNI and certificate verification. This avoids a second DNS lookup between checking and connecting.
- Environment proxy settings and browser cookies are not used. The scraper does not send local files, prompts, chat history, or account tokens to sources.
- HTML is extracted as inert text; scripts, styles and several navigation/form elements are omitted. Website assets are not loaded by the scraper.
- A backend system instruction treats web snapshots as untrusted reference material and requests URL citations. It cannot guarantee model compliance, but website text has no executable tool path.
- Cache files live beneath `LAW_DATA_DIR/web`; session copies follow existing session persistence and export behavior. They are user data and remain ignored by Git.
- Source cache and jobs are separate: completed snapshots persist, while job status is process-local and disappears on backend restart. There is no automatic resume or retry after restart.

## File/API map

| File | Responsibility |
|---|---|
| `backend/services/web_access.py` | Approved-source adapters, URL/DNS validation, paced HTTP requests, cache, extraction, job lifecycle and cancellation. |
| `backend/routes/web.py` | `POST /web/jobs`, `GET /web/active`, `GET /web/jobs/{id}`, `POST /web/jobs/{id}/stop`. |
| `backend/main.py` | Router registration and web-reference instructions for local chat. |
| `src/webAccess.js` | API helpers, bounded source message construction, creation and persistence of a new source chat. |
| `src/components/WebAccess.jsx` and `.css` | Collapsible importer, progress, Stop, preview, source link and new-chat action. |
| `src/App.jsx` | Places the importer in the existing Chat pane. |
| `tests/backend/test_web_access.py` | URL restrictions, DNS pinning, persistent budget/cache/cooldown, robots, size limits, API errors, routes and true cancellation. |
| `tests/frontend/webAccess.test.js` | Source attribution and excerpt budget through context serialization; separate saved-chat creation. |

## General ingestion update

The two-host allowlist was replaced with a general public-HTTPS importer. The gate moved from *which site* to *which address*: `normalize_url` rejects on scheme, credentials and hostname shape, `address_rejection` rejects on the resolved address, and both run again on every redirect hop. `is_global` alone was not enough -- it reports multicast and NAT64 addresses as global, and `64:ff9b::7f00:1` is a globally-routable-looking address that a NAT64 gateway delivers to `127.0.0.1`.

Item 2 below is therefore largely delivered. Items 1, 3, 4 and 5 remain open.

## Expansion proposal

1. **Source library and full-document retrieval.** Add a durable source record with immutable revisions and chunk IDs based on source identity plus content hash. Store URL, title, fetched time, license, revision and section on chunks. Stage embeddings before changing the active revision, and filter retrieval to sources attached to the current chat. Expose selected excerpts as source cards; test citation-to-chunk mapping, failed replacement, deletion/restore, and offline reuse. Add cache browsing, explicit refresh, storage usage, export and recoverable source removal. Do not reuse filename-based replacement for this.
2. **Additional public domains.** Add reviewed adapters and per-domain policy configuration, keeping the same network gate and pacing. Improve semantic HTML extraction, handle approved redirects by revalidating every hop, and honor HTTP cache validators. Only add public HTTPS pages whose access rules support the intended use. Validate Unicode hostnames, all redirect targets, mixed DNS answers, decompression limits, malformed HTML and extraction quality before broadening the allowlist.
3. **Internet search.** Introduce a separate search provider interface. Choose a documented provider and make its cost/credentials and query transmission visible. Search queries may leave the machine; local chat remains local. Show results for user selection before importing. Do not scrape search-engine result HTML as an implicit dependency.
4. **Bounded multi-page collection.** Add an explicit page selection, depth/page/byte budgets, domain-scoped queues, deduplication, durable jobs and source previews. Keep one request at a time by default, and let all work share the request budget. Use supported bulk datasets for large collections instead of increasing request frequency.
5. **Authenticated or dynamic sites.** Separate project phase with provider-specific authorization, credential storage, data retention and logout/revocation. A browser renderer would load many subresources and needs its own total network accounting. Public-page success does not establish permission or readiness for logged-in collection.

Reddit is deferred: its current Responsible Builder Policy requires explicit approval before API data access. Public visibility alone is insufficient to make it an anonymous scraping demo. Wikipedia is the first real information source; Books to Scrape is the HTML extraction test fixture.

## Verification and acceptance

- Focused tests initially passed: 26 backend web tests and 2 frontend web tests.
- Full verification initially passed: 164 frontend tests, 290 backend tests, production Vite build. Backend test execution set `LAW_DATA_DIR` to a unique temporary directory before imports, protecting live stores and logs.
- Live Wikipedia import succeeded using the real service: Solar energy, 35,252 extracted characters, revision 1371874595, URL/retrieval time/attribution stored. This is an observation at import time, not a promise of the current Wikipedia revision later.
- Live Books to Scrape import succeeded through the UI after robots lookup and pacing; initial extraction contained 1,497 characters. Its prices and ratings are demonstration data.
- UI checks passed for explicit import, progress, source preview, cache reuse and creation of the demo chat. The final desktop build was restarted and opened to **Web: Solar energy**, session `f921474e`, with the imported excerpt, a user question, and a completed Qwen3.5 9B answer. The answer cited the source URL and disclosed that it had only an excerpt. It also made an unsupported comparison to the length of a typical Wikipedia page; citation prompting does not guarantee factual accuracy.
- Final verification after the active-job recovery change passed again: 164 frontend tests, 290 backend tests, production build. The restarted live backend exposes `/web/active` and reports no pending job. The saved demo retained all three messages after restart.
- Exactly three outgoing source requests were recorded during the live demo: Wikipedia API, Books to Scrape robots.txt, and Books to Scrape HTML. The latter two started 10.55 seconds apart. Cache reuse, chat creation, local inference and desktop reopening added no website requests.
- Synthetic tests exercise denials, rate limits and cancellation instead of intentionally overloading a real site.

Acceptance for this first release is a successful supported-source fetch, an honest blocked/unsupported result, persistent pacing, no partial-save on cancellation, a saved attributed source chat, and a real local-model answer without any new outbound source request.

## Primary references

- [MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette): serial requests, identifiable User-Agent, caching and load sensitivity.
- [Wikimedia User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy): meaningful client identification and contact information.
- [Books to Scrape](https://books.toscrape.com/): public site explicitly intended for scraping practice; data values are fictional.
- [Reddit Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy): access approval and transparency requirements.
