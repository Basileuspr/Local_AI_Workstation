# Web Research & Sources

October 8, 2026. This implementation follows inspection of the actual dirty checkout, including the completed Browser foundation and Reels Analyzer. Concurrent, unrelated work was preserved. The public importer remains a separate deliberate import feature.

## Inspected baseline

| Existing behavior | Gap before this change |
| --- | --- |
| `electron/viewerBrowser.js`, browser profiles, fixed semantic page tools, sandboxed remote pages, trusted named IPC and private-address guards | A selected browser page could be navigated and read, but there was no current-question research workspace or durable public monitor. |
| `services/web_access.py` and `/web` public HTTPS importer | It extracted public text/images and retained import snapshots. It was neither temporary research nor a crawler. Website JavaScript and authenticated sessions were not shared. |
| Ollama local completions, context budgets, request queue, runtime coordination | Reusable query/answer inference and embedding admission; queue history was confined to a backend run. |
| Chroma Knowledge chunks and existing Knowledge graph/options SQLite | Persistent, explicit ingestion could be reused. No crawler database or monitoring lifecycle existed. |
| Electron-owned FastAPI process, maintenance gate and process locks | Closing the desktop stopped its backend and contained subprocesses. A child launched by that backend alone would not provide independent monitoring. |

## Separate capabilities and storage

The Workspace navigation now includes **Web Research & Sources**, with **Live research** and **Recurring sources** views. Knowledge and Index retain their existing interfaces.

* **Live research:** local model produces up to two queries; configurable search ranks results; destination-checked retrieval reads up to six pages and can follow two useful links. Canonical URLs and normalized content hashes prevent duplicates. Relevant excerpts fit the selected model's actual context limit, capped at 8,192. Local synthesis returns source IDs, literal quotes and a second support check. Unknown citations, uncaptured quotes, generated URLs and unsupported numeric/date/version tokens reject the answer. Publication metadata, when captured, is distinguished from retrieval time. Source text remains untrusted throughout. These checks establish support in the captured sources; they cannot prove the sources' claims true or establish completeness across the whole Internet.
* **Temporary research:** page bodies, questions, source metadata and answers remain in backend memory. A reaper removes completed research 30 minutes after completion, within a 30-second sweep interval. Discard, cancellation and backend shutdown clear it; failed initial synthesis discards bodies. A maximum of 20 retained requests and one active request bounds memory. There is no automatic chat, gallery, Index or Knowledge write. Restarting the backend loses research deliberately.
* **Recurring sources:** deliberately configured name, seed, enabled state, interval, allowed hosts, include/exclude URL/path globs, depth/page budgets, request interval, discovery controls and retention policy. HTTP/HTTPS pages, known URLs, internal links, RSS/Atom, declared feeds, robots-declared sitemaps and `/sitemap.xml` form a bounded persistent frontier. Feed/sitemap metadata can be read within allowed hosts while page inclusion rules still govern discovered article URLs. The source is cancelled if its configuration changes during a run.
* **Operational state:** `data/web-system/crawl-state.sqlite3`, WAL transactions. Sources, schedules, first/last seen/check/change times, canonical URLs, ETag, Last-Modified, normalized hashes, HTTP status, failure counters, retry time, last successful run, jobs, owner fences, frontiers and notifications. No page body column. One active job per source; one independent writer protected by the existing OS-lock utility. Restart converts interrupted RUNNING jobs to RETRY and continues the committed frontier. Checkpoint, page metadata and notification commit together. Already committed pages and events are not replayed.
* **Retained content:** separate `data/web-system/content/latest.sqlite3`, only when **Keep latest content** is chosen. Monitor-only retains metadata. Notify-on-changes creates bounded notifications visible in the Sources pane; it sends no messages outside the app. Keep-latest updates on actual content change, with a 100 MiB logical body budget. Clearing it preserves operational state, account profiles and Knowledge. After clearing, the next keep-latest check retrieves a full body rather than sending validators for content that no longer exists.
* **Knowledge:** **Save to Knowledge** is an explicit human-selected handoff. A normalized document includes URL, title, captured publication date, retrieval time, source ID, hash, content type and untrusted-source text. It uses the existing embedding queue, local Ollama embeddings and Chroma ingestion, with a deterministic URL/version identity preventing duplicate embeddings. No automatic crawling-to-Knowledge policy is enabled. Archive versions, automatic changed-page ingestion and external notifications remain future retention/action adapters, rather than placeholder settings presented as working.

## Background lifecycle

**Enable background monitoring** registers and starts a fixed, per-data-root Windows scheduled task under the current user, with limited privileges. It launches `backend/web_worker.py` directly through Task Scheduler, outside the desktop backend's process tree. At-logon and five-minute watchdog triggers, bounded task restart settings and the worker's OS singleton lock handle relaunches. SQLite schedules and jobs drive actual work. No HTTP listener, desktop credential, model process or browser cookie is given to the worker.

The task runs while that Windows user is logged in, including after closing the workstation window. This is not a machine-wide service for logged-out users. Reboot/login triggers are installed and inspected, but a real OS reboot was not performed during verification. The task is installed only by the explicit desktop control; no real source or persistent task was installed as part of development.

**Disable background monitoring** disables triggers and requests cooperative worker shutdown; unfinished jobs retain checkpoints for later recovery. Checks stay PENDING while disabled. Individual sources and runs also support pause/enable/cancel. Per-page failures back off without preventing other pages from being checked; four attempts bound retries, 60-second exponential backoff handles temporary failures, and hourly/cooldown limits defer work. Each processing quantum is bounded to ten minutes, after which a remaining frontier is checkpointed for retry. Page/depth budgets produce observable PARTIAL runs. Subsequent scheduled runs revisit the seed and known pages; interrupted work continues its durable frontier.

The maintenance gate refuses backup/reset while monitoring is enabled or a worker is still active. Disable it and wait for shutdown first. The headless worker also honors reset/import sentinels. No existing maintenance lifecycle was redesigned.

For an explicitly configured non-Windows service, invoke the same headless entry point with the actual data root:

```text
python backend/web_worker.py --data-root <app-data-root>
```

The database `background_enabled` setting must be enabled by an administrator/host setup; a service manager must supervise this command. The provided desktop installation control is Windows-specific.

## Providers, rendering and security

Wikipedia search is the credential-free default with encyclopedia-only coverage. General web search requires a configured **public SearXNG JSON search endpoint**, typically ending in `/search`. Instances must enable JSON output; a refusal or timeout is reported. The supported API contracts are documented by [SearXNG](https://docs.searxng.org/dev/search_api.html) and [MediaWiki](https://www.mediawiki.org/wiki/API:Search). A local/private SearXNG exception, credentialed search APIs and provider-specific bypasses are not exposed. Explicit public seed URLs work even when search fails, with coverage reported as partial.

Unreadable/JavaScript-only pages can be opened manually in the existing Browser. **Use current Browser page** captures bounded, redacted rendered prose through the fixed semantic interface. It binds profile, current document and URL, rejects page changes, and pauses at login challenges. Password/hidden/form fields and browser secrets are excluded. This is an explicit one-page research fallback, not automatic headless crawling of account pages. Renderer IPC is trusted-window-only; the backend fallback and scheduler installation require the native desktop capability. Reels page ownership blocks a concurrent research capture.

Shared transport reuses the public importer's public-address classification, DNS validation and checked-address pinning with hostname TLS verification/SNI, disabled environment proxy trust, bounded requests and manual redirect validation. New explicit HTTP support defaults off for the existing HTTPS importer. HTTPS downgrade redirects, URL credentials, private/mixed DNS answers, signed/credential-bearing source addresses and redirect escapes are rejected. Robots policies fail closed on temporary retrieval failures, honor deny/rate rules and validate policy redirects. All new requests share a cross-process rate lock and persisted budget: at least ten seconds completion-to-start spacing, 30 requests per hour, site cooldowns, five redirects, 5 MiB body and 80,000 extracted-character limits. No arbitrary headers, JavaScript, debugger, selectors, raw cookies or arbitrary paths are accepted by research tools.

XML entity/DOCTYPE declarations, excessive XML trees, unsupported binary/media responses and incomplete extraction are rejected before actions. Browser-account acquisition remains in its separate subsystem; monitoring uses public HTTP retrieval without cookies. Operational metadata is bounded to 100 sources, 2,000 recent URLs per source, 500 terminal jobs and 500 change events. These bounds can evict old metadata/history; this is operational state, not an unlimited archive. Logical retained-content limits exclude SQLite file/WAL overhead. Empty importer-style cache directories may exist in transport storage, but no research/crawl page snapshots are written there.

## Verification and limits

Controlled fixtures cover source rules, private/credentialed destinations, pinned DNS, redirect/robots/feed boundaries, XML entity rejection, conditional 304, normalized unchanged hashes, independent retention, recovery of committed frontiers, deferred page failures, cancellation through both the research controls and shared queue, cross-process lock release, source changes, maintenance exclusion, duplicate Knowledge handoff, authenticated/natively gated routes, temporary expiry and model timeout cleanup. The original public importer tests are retained.

`tests/backend/test_web_worker.py` starts a separate production worker with owned page adapters, attempts a competing writer, kills it mid-page and restarts it. Only the unfinished page is retried; the committed seed and notifications are not duplicated.

`scripts/qa-web-background.py` installs an empty-source fixture task in a temporary data root, exits its launching process, verifies that the production worker heartbeat keeps progressing, then disables/stops/unregisters that exact task. It does not perform an OS reboot or run real configured monitors.

`scripts/qa-web.cjs` drives the actual Electron/React pane against isolated fixture routes and a pinned owned HTTPS page. It verifies cited answers, retrieval timestamps, explicit Knowledge selection, rendered capture without password/hidden/session secrets, recurring source creation, pending/cancelled runs, content clearing that preserves a Chromium login cookie, no horizontal overflow and remote-renderer IPC rejection. Fixture models and the fixture Knowledge adapter are clearly separate from real provider/embedding behavior.

`scripts/qa-web-local.py` uses real local Mistral for query planning, cited synthesis and support checking over two owned public-page responses, then performs an explicit real local embedding/Chroma handoff in a temporary data root and verifies duplicate prevention and Knowledge preservation after research discard. General SearXNG deployments and live website compatibility remain unverified; no configured endpoint was supplied. Browser foundation/Reels fixture coverage is recorded separately in [BROWSER_FOUNDATION.md](BROWSER_FOUNDATION.md) and [REELS_ANALYZER.md](REELS_ANALYZER.md). Instagram acquisition and real-account MFA/session expiry remain unverified until a specific account/source is tested; login is not proof of complete reel media acquisition.

Focused commands:

```powershell
venv/Scripts/python.exe -m pytest tests/backend/test_web_system.py tests/backend/test_web_research.py tests/backend/test_web_worker.py tests/backend/test_web_access.py tests/backend/test_web_images.py tests/backend/test_tool_registry.py
npm run test -- tests/frontend/webResearch.test.js tests/frontend/webAccess.test.js tests/frontend/browserFoundation.test.js tests/frontend/reelsAnalyzer.test.js tests/frontend/navigation.test.jsx tests/frontend/navigationOrder.test.jsx tests/frontend/toolRegistry.test.jsx
node scripts/build-browser-foundation-fixture.mjs
node scripts/qa-web.cjs
venv/Scripts/python.exe scripts/qa-web-background.py
venv/Scripts/python.exe scripts/qa-web-local.py
```

Production build identity is captured by the existing build workflow. Build from the resolved checkout directory on Windows if a junction alias causes asset-path issues; the existing `LAW_BUILD_REVIEW_DIR` override can choose an owned review destination when another process holds the default review output. No build/security gate was removed. The focused checks do not establish full-app, packaged installer, reboot, arbitrary-site or real-account acceptance.
