export const webHelp = {
  'web-system': [['Live research', [
    ['Research question / Local model / Research now', 'Ask a focused question using an installed local text model. Search and bounded public-page retrieval supply cited evidence; check quotes and coverage before relying on the answer.'],
    ['Source URLs / Page limit / Follow useful links', 'Optionally provide public seed addresses, retrieve up to six pages, and allow bounded link following. Private-network and credential-bearing addresses are rejected.'],
    ['Search provider / Save search provider', 'Wikipedia is the default with encyclopedia-only coverage. General search requires a public SearXNG endpoint supporting JSON results. Failures appear in Coverage.'],
    ['Browser fallback / Use current Browser page', 'Manually open an unreadable page in the shared Browser and capture its current rendered prose. Login challenges or page changes stop capture. This does not grant unattended access to account pages.'],
    ['Cancel research / Discard research', 'Cancel stops active work; Discard clears its temporary evidence. Research stays in memory, expires after completion, and is lost on backend restart.'],
    ['Save to Knowledge', 'Explicitly saves one selected captured source through local embeddings. Research results are never indexed automatically.'],
  ]], ['Recurring sources', [
    ['Add source / Edit / Save source changes', 'Choose a public seed, interval, allowed domains, inclusion rules, page/depth limits, and optional feed/sitemap discovery. Configuration changes cancel an active run.'],
    ['Retention', 'Monitor only keeps metadata; Keep latest content retains a bounded current version; Notify on changes shows events in this pane. No external messages are sent.'],
    ['Enable background monitoring / Disable background monitoring', 'Explicitly installs or disables the Windows task for this data root. Monitoring can continue after closing the app while this user is logged in. Disable and wait for shutdown before backup or reset.'],
    ['Pause source / Enable source / Check now / Cancel run', 'Control scheduled checks and review their Pending, Retry, Partial or completed state. Checks wait while background monitoring is disabled.'],
    ['Page status / Clear retained content', 'Inspect status and change times. Clearing content preserves crawl metadata, Knowledge and browser logins; Save latest to Knowledge is a separate selected-source action.'],
  ]]],
  'reels-analyzer': [['Account and analysis', [
    ['Open account browser / Check account', 'Choose the original account profile, log in manually including MFA, and check its visible account identity. A recognized login does not prove that complete reel media can be acquired.'],
    ['Use this conversation', 'Discover up to 100 visible stable reel links from the selected conversation. Scroll and repeat to include links outside a virtualized visible region.'],
    ['Local vision / Local summary / Transcription', 'Choose installed local vision, summary and Whisper models. Analysis requires complete verified media and caption acquisition before model processing.'],
    ['Analyze discovered reels / Video label', 'Start the selected batch. If a page has multiple video players, identify the intended player with its visible label. Incomplete or unsupported acquisition is reported separately.'],
    ['Pause after this reel / Cancel', 'Pause finishes the current save and cleanup before stopping. Cancel requests worker shutdown and retains ownership until stopping completes. Saved summaries remain available.'],
    ['Resume remaining reels / Open source conversation', 'Select the original account profile, then restore the saved conversation and verify its account. Recovery skips saved reel identities and can be retried after a failed return.'],
    ['Clear cache', 'Remove disposable reel evidence while preserving browser sessions and saved summaries. Wait for processing to stop first.'],
    ['Saved reel summaries / Repository link', 'Review short evidence-checked summaries and the original source link. An uncertain repository address is marked Repository link not identified. Links open only when clicked; real-site compatibility requires separate verification.'],
  ]]],
};
