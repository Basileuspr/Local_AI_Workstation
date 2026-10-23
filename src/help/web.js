export const webNavigationHelp = ['Web navigation', [
  ['Web', 'Expand Web in the main navigation for Browser, Research & Sources, and Reels Analyzer. Find a tab also searches these tools; Arrange can move the Web group and its tools. HTML, CSS and JavaScript editors remain in Viewers.'],
  ['Choose a web tool', 'Browser is for interactive pages and account profiles. Research & Sources contains Search & preview, Live research, Recurring sources and Import page. Reels Analyzer uses a manually signed-in account conversation and installed local analysis models.'],
  ['Shared browser and public retrieval', 'Browser, the Reels account browser and the research browser fallback share the selected page and account profile in the main window. A visible Browser side pane keeps the page there. Public search, preview, imports and recurring checks use separate guarded retrieval without browser cookies or sign-ins. Switching tools does not clear account data or cancel submitted jobs; another browser workflow cannot take over a page owned by Reels.'],
]];

export const webHelp = {
  'web-system': [webNavigationHelp, ['Research modes', [
    ['Search & preview / Live research / Recurring sources / Import page', 'Choose one mode to see its controls. Left and Right arrows cycle the mode tabs; Home and End select the first and last. Draft questions, source settings, import state and search results remain available while switching modes. Refreshing the app clears unsaved drafts and temporary browser-only state.'],
  ]], ['Search & preview', [
    ['Search the web / Search', 'Return up to ten source links and brief provider descriptions without starting a local model. Wikipedia is encyclopedia-only; choose Brave or configure SearXNG for general web coverage. Search snippets are untrusted and do not prove the page was fetched.'],
    ['Search provider settings', 'Brave uses your own Web Search API key; SearXNG needs a public HTTPS endpoint with JSON enabled. Queries leave this computer. A key entered here stays in backend memory until restart, is never returned to the interface, and is not saved in search settings. LAW_BRAVE_SEARCH_API_KEY can provide a local environment key across restarts. No subscription is purchased automatically.'],
    ['Page URL / Preview this page / Preview page', 'Read one selected public page through guarded retrieval. The description is labelled as publisher metadata or a captured excerpt. The original URL, actual fetched URL and retrieval time remain visible. Pages requiring login or JavaScript may be unavailable.'],
    ['Include one page image', 'Try up to three discovered HTTPS images and save at most one validated PNG, JPEG, WebP or GIF locally. The image stays in the local blob store; source text remains available if image retrieval fails. Private destinations, unsafe redirects and unsupported images are blocked.'],
    ['Stop web request / Clear results', 'Stop cancels the active request but keeps captured page text. Clear removes temporary job results, preserving saved chats and image blobs. Unsaved text expires after 30 minutes or backend restart. Requests respect robots, at least ten seconds spacing and the shared hourly budget.'],
    ['Save source in new chat', 'Save a separate source chat with attribution, up to 6,000 text characters and the optional image attachment. Reopening it reuses that chat. The model is not automatically given image pixels or OCR, and no Knowledge indexing occurs.'],
  ]], ['Live research', [
    ['Research question / Local model / Research now', 'Ask a focused question using an installed local text model. Search and bounded public-page retrieval supply cited evidence; check quotes and coverage before relying on the answer.'],
    ['Source URLs / Page limit / Follow useful links', 'Optionally provide public seed addresses, retrieve up to six pages, and allow bounded link following. Private-network and credential-bearing addresses are rejected.'],
    ['Search provider / Save search provider', 'Uses the same saved Brave, SearXNG or limited Wikipedia provider as Search & preview. General search requires a configured provider. Failures appear in Coverage.'],
    ['Browser fallback / Use current Browser page', 'Manually open an unreadable page in the shared Browser and capture its current rendered prose. Login challenges or page changes stop capture. This does not grant unattended access to account pages.'],
    ['Cancel research / Discard research', 'Cancel stops active work; Discard clears its temporary evidence. Research stays in memory, expires after completion, and is lost on backend restart.'],
    ['Save to Knowledge', 'Explicitly saves one selected captured source through local embeddings. Research results are never indexed automatically.'],
  ]], ['Recurring sources', [
    ['Add source / Edit / Save source changes', 'Choose a public seed, interval, allowed domains, inclusion rules, page/depth limits, and optional feed/sitemap discovery. Configuration changes cancel an active run.'],
    ['Retention', 'Monitor only keeps metadata; Keep latest content retains a bounded current version; Notify on changes shows events in this pane. No external messages are sent.'],
    ['Enable background monitoring / Disable background monitoring', 'Explicitly installs or disables the Windows task for this data root. Monitoring can continue after closing the app while this user is logged in. Disable and wait for shutdown before backup or reset.'],
    ['Pause source / Enable source / Check now / Cancel run', 'Control scheduled checks and review their Pending, Retry, Partial or completed state. Checks wait while background monitoring is disabled.'],
    ['Page status / Clear retained content', 'Inspect status and change times. Clearing content preserves crawl metadata, Knowledge and browser logins; Save latest to Knowledge is a separate selected-source action.'],
  ]], ['Import page', [
    ['Public page URL / Import page', 'Explicitly retrieve one public page without a model or browser login. This is the same importer available through Chat’s Internet shortcut. Pages that require authentication or JavaScript may not be readable.'],
    ['Save page images locally', 'Optionally retrieve up to 24 images, 10 MB each and 50 MB total. Saved images stay available in the source chat; text inside images is not automatically read by the chat model.'],
    ['Stop import', 'Stop the active import. A source chat can be created only after an import completes. Switching modes keeps the import running; return here or to Chat’s Internet panel to review or stop the active import.'],
    ['Open new chat with source', 'Save a separate chat containing attribution, up to 6,000 extracted text characters and any saved images. Finish or stop the current chat reply first. Importing does not automatically index Knowledge.'],
  ]]],
  'reels-analyzer': [webNavigationHelp, ['Account and analysis', [
    ['Account & conversation / Local analysis', 'Follow the two setup sections: open the source conversation and discover its reels, then review local models and start analysis. Pause and Cancel appear while a batch is active. Saved summaries and recovery actions stay below the setup.'],
    ['Open account browser / Check account', 'Choose the original account profile, log in manually including MFA, and check its visible account identity. A recognized login does not prove that complete reel media can be acquired.'],
    ['Use this conversation', 'Discover up to 100 visible stable reel links from the selected conversation. Scroll and repeat to include links outside a virtualized visible region.'],
    ['Local vision / Local summary / Transcription', 'Choose installed local vision, summary and Whisper models. Analysis requires complete verified media and caption acquisition before model processing.'],
    ['Analyze discovered reels / Video label', 'Start the selected batch. If a page has multiple video players, identify the intended player with its visible label. Incomplete or unsupported acquisition is reported separately.'],
    ['Pause after this reel / Cancel', 'Pause finishes the current save and cleanup before stopping. Cancel requests worker shutdown and retains ownership until stopping completes. Saved summaries remain available.'],
    ['Resume remaining reels / Open source conversation', 'Select the original account profile, then restore the saved conversation and verify its account. Recovery skips saved reel identities and can be retried after a failed return.'],
    ['Cache management → Clear cache', 'Expand Cache management to remove disposable reel evidence while preserving browser sessions and saved summaries. Wait for processing to stop first.'],
    ['Saved reel summaries / Repository link', 'Review short evidence-checked summaries and the original source link. An uncertain repository address is marked Repository link not identified. Links open only when clicked; real-site compatibility requires separate verification.'],
  ]]],
};
