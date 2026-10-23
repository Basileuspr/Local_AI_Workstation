# Web Research & Sources

This workspace separates search/preview, temporary model-assisted research and
explicit recurring public sources. The Browser and public URL importer have
different lifetimes and authentication boundaries.

## Search and preview

1. Open **Web Research & Sources → Search & preview**.
2. Choose a provider, enter a query and search. Cards show provider snippets,
   not evidence that the destination page was read.
3. Select **Preview this page**, or enter a direct Page URL.
4. Optionally include one page image. Review the final URL, retrieval time and
   available publication metadata.
5. Use **Save source in new chat** to save attribution and a bounded excerpt.

No local model is needed for search or direct preview. Image failure retains
captured text. Saving a chat does not index Knowledge, create a recurring source
or automatically send image pixels/OCR to the chat model.

Jobs are memory-only, with one active lookup, at most 20 retained jobs and expiry
30 minutes after completion. Clear results discards temporary results; saved chats
and image blobs remain governed by normal explicit storage cleanup.

## Providers

Wikipedia is the credential-free encyclopedia provider. General search supports
Brave with your API key or a public HTTPS SearXNG JSON endpoint, usually ending
in /search. SearXNG must allow JSON responses. Provider failure does not silently
switch general search to encyclopedia coverage. Direct preview needs no key.

The provider receives the submitted query. A Brave key entered in settings stays
in backend memory; the API reports only presence/source. Remove session key can
fall back to a configured environment key. For persistence set
`LAW_BRAVE_SEARCH_API_KEY` in the local launch environment. Never put credentials
in source URLs or committed settings. Only the fixed Brave API endpoint receives
its key, without redirect forwarding.

## Live research

An installed local model proposes queries, reads a bounded selection of checked
pages and synthesizes an answer with source IDs/quotes. Context is limited by the
selected model and the research cap. Unknown citations, uncaptured quotes and
unsupported numeric/date/version tokens reject a draft.

These checks establish support in captured evidence, not that a publisher is
correct or that the whole web was searched. Explicit seed URLs can provide partial
coverage when search fails. Questions, bodies and answers are temporary; discard,
expiry and backend shutdown remove them. No automatic chat/Knowledge write occurs.

For a JavaScript-only page, open it manually in Browser and explicitly use
**Use current Browser page**. Bounded redacted prose is bound to the current
profile/document/URL. Login challenges or changed pages stop capture. Browser
secrets/forms are excluded and Reels ownership prevents competing capture.

## Recurring sources

Create a named source with seed, allowed hosts, path rules, interval, discovery
limits and retention policy. Public links, feeds and sitemaps populate a bounded
frontier. Configuration changes cancel the current run.

Operational SQLite stores URLs, hashes, timestamps, validators, jobs/checkpoints
and notifications without page bodies. Monitor-only retains metadata. Keep latest
content uses a separate bounded store. Notify-on-changes creates in-app
notifications; it does not send external messages.

**Save to Knowledge** is a separate explicit handoff using the existing embedding
queue and source/version identity. Automatic changed-page indexing and unlimited
version archives are not implemented. Clearing retained content preserves crawl
state and Knowledge; later retrieval obtains a new body.

Independent monitoring requires the explicitly installed/enabled background worker.
It is not created by simply opening the workspace. On Windows, use its provided
background controls and inspect status before closing the desktop. Disable and
wait for the worker before app reset/import. For an explicitly managed non-Windows
service, the entry point is `python backend/web_worker.py --data-root <app-data-root>`;
host setup must enable it and supervise the process.

## Public retrieval and importer

The existing public HTTPS importer retains explicit import snapshots and can save
selected text/images. It does not share Browser cookies, execute page JavaScript
or become an authenticated crawler. Temporary research/monitoring does not write
page snapshots into that importer cache.

Transport validates public destinations and all DNS answers, pins checked
addresses with TLS hostname verification, disables environment proxy trust and
revalidates redirects. Credential-bearing URLs, private/mixed DNS, HTTPS downgrade
and redirect escapes are rejected.

Page/image retrieval respects robots rules, pacing, cooldowns and bounded byte/
pixel/extraction limits. Temporary robots failures fail closed. Search API calls
use their fixed provider contracts. Sources cannot supply arbitrary headers,
cookies, paths, scripts or debugger commands.

[Browser](BROWSER.md) · [Tool execution](TOOL_REGISTRY.md) ·
[Verification and live-provider limits](VERIFICATION.md)
