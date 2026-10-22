import {useEffect, useRef, useState} from 'react';
import {webSystem} from '../webSystem';
import {createWebChat, webImageUrl} from '../webAccess';
import WebImageReader from './WebImageReader';
import SearchProviderSettings, {providerName} from './SearchProviderSettings';

const running = job => job && ['PENDING', 'RUNNING'].includes(job.status);
const stageName = {queued:'Waiting for the web request lane', searching:'Searching', reading:'Reading the selected page', image:'Page text ready; checking an image', ready:'Ready', stopped:'Stopped'};

export default function WebSearch({active, config, onConfig, model, onOpenSession, isGenerating=false}) {
  const [query, setQuery] = useState(''), [url, setUrl] = useState(''), [includeImage, setIncludeImage] = useState(true);
  const [searchJob, setSearchJob] = useState(null), [previewJob, setPreviewJob] = useState(null);
  const [results, setResults] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saved, setSaved] = useState({});
  const working = useRef(false), generation = useRef(0), previewRef = useRef(null);
  const job = running(previewJob) ? previewJob : running(searchJob) ? searchJob : null;
  const source = previewJob?.source;
  useEffect(() => {
    if (active && source?.id) previewRef.current?.scrollIntoView?.({block:'start', behavior:'smooth'});
  }, [active, source?.id]);
  useEffect(() => {
    const timer = setInterval(() => {
      const expired = item => item && !running(item) && item.expires_at * 1000 <= Date.now();
      setSearchJob(item => expired(item) ? null : item);
      setPreviewJob(item => expired(item) ? null : item);
      setResults(item => expired(item) ? null : item);
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  function accept(next) {
    if (next.kind === 'search') {
      setSearchJob(next);
      if (['COMPLETED','PARTIAL'].includes(next.status)) setResults(next);
    } else setPreviewJob(next);
  }
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const version = generation.current;
    webSystem('/lookup/active').then(({job:current}) => {
      if (!disposed && version === generation.current && current) accept(current);
    }).catch(e => {if (!disposed) setError(e.message);});
    return () => {disposed = true;};
  }, [active]);
  useEffect(() => {
    if (!active || !job?.id) return;
    let disposed = false, timer;
    async function poll() {
      try {
        const next = await webSystem('/lookup/' + job.id);
        if (disposed) return;
        accept(next); setError('');
        if (running(next)) timer = setTimeout(poll, 1000);
      } catch (e) {
        if (!disposed && e.status === 400) {
          const failed = current => current?.id === job.id ? {...current, status:'FAILED', stage:'stopped', error:'This request expired or the backend restarted. Start a new search or preview.'} : current;
          setSearchJob(failed); setPreviewJob(failed); setError('');
        } else if (!disposed) {setError(e.message + ' You can retry or stop the request.'); timer = setTimeout(poll, 3000);}
      }
    }
    void poll();
    return () => {disposed = true; clearTimeout(timer);};
  }, [active, job?.id]);
  async function perform(operation) {
    if (working.current) return;
    working.current = true; generation.current += 1; setBusy(true); setError(''); setNotice('');
    try {await operation();} catch (e) {setError(e.message);}
    finally {working.current = false; setBusy(false);}
  }
  function preview(value) {
    if (job) return;
    setUrl(value);
    return perform(async () => accept(await webSystem('/preview', {url:value, include_image:includeImage})));
  }
  async function openChat() {
    if (!source || isGenerating) return;
    await perform(async () => {
      let session = saved[source.id];
      if (!session) {
        session = await createWebChat(source, model);
        setSaved(current => ({...current, [source.id]:session}));
      }
      if (onOpenSession && await onOpenSession(session.id) === false) throw Error('The source chat was saved but could not be opened. Select it from Chats.');
      setNotice('Saved source and image in chat: ' + session.title);
    });
  }
  return <section className="web-search" aria-label="Search and preview">
    <p>Search for links and short descriptions, then preview a selected page. No local model is needed. Page text is untrusted source material; descriptions are provider snippets or page excerpts, not verified facts.</p>
    <form onSubmit={e => {e.preventDefault(); if (!job) void perform(async () => accept(await webSystem('/lookup', {query:query.trim()})));}}>
      <label>Search the web<input aria-label="Search the web" type="search" required minLength={2} maxLength={300} value={query} onChange={e => setQuery(e.target.value)} placeholder="Topic, product or question" /></label>
      <div className="web-toolbar"><button type="submit" disabled={busy || !!job || !config || query.trim().length < 2}>Search</button><span>Provider: {config ? providerName(config.provider) : 'Loading…'}</span></div>
    </form>
    <SearchProviderSettings config={config} onSaved={onConfig} disabled={busy || !!job} />
    <form onSubmit={e => {e.preventDefault(); void preview(url.trim());}}>
      <label>Page URL<input aria-label="Page URL" type="url" required maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/article" /></label>
      <div className="web-toolbar"><button type="submit" disabled={busy || !!job || !url.trim()}>Preview page</button>
        <label><input type="checkbox" checked={includeImage} disabled={busy || !!job} onChange={e => setIncludeImage(e.target.checked)} />Include one page image</label>
        {job && <button type="button" disabled={busy} onClick={() => perform(async () => accept(await webSystem('/lookup/' + job.id + '/cancel', {})))}>Stop web request</button>}
        <button type="button" disabled={busy || !!job || (!searchJob && !previewJob && !results)} onClick={() => perform(async () => {
          for (const id of new Set([searchJob?.id, previewJob?.id, results?.id].filter(Boolean))) {
            try {await webSystem('/lookup/' + id + '/discard', {});} catch (e) {if (e.status !== 400) throw e;}
          }
          setSearchJob(null); setPreviewJob(null); setResults(null); setSaved({});
        })}>Clear results</button>
      </div>
    </form>
    <p className="web-search-note">Requests respect website rules and pause at least 10 seconds between requests, with a 30-request hourly budget. Search and preview text expires after 30 minutes or backend restart. Included images are saved locally; save a source chat to retain its text and image together.</p>
    {job && <p role="status">{stageName[job.stage] || job.stage}…</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {[searchJob, previewJob].filter(Boolean).map(item => <div key={item.id}>
      {item.error && <p role="alert">{item.kind === 'search' ? 'Search' : 'Page preview'}: {item.error}</p>}
      {item.status === 'CANCELLED' && <p role="status">Web request stopped. Any captured page text remains available below.</p>}
      {item.warnings?.map((warning, i) => <p key={i} role="status">{warning}</p>)}
    </div>)}
    {results && <div className="web-search-results" aria-label="Search results">
      <h3>Results for “{results.value}”</h3><p>{providerName(results.provider)} · Search snippets; pages have not been fetched.</p>
      {!results.results.length && <p>No results returned. Try a different query or provider, or preview a known URL.</p>}
      {results.results.map(row => <article className="web-search-card" key={row.url}>
        <h4><a href={row.url} target="_blank" rel="noreferrer">{row.title}</a></h4><span>{row.domain}</span>
        <p>{row.snippet || 'No description supplied by this provider.'}</p>
        <button type="button" disabled={busy || !!job} onClick={() => preview(row.url)} aria-label={'Preview ' + row.title}>Preview this page</button>
      </article>)}
    </div>}
    {source && <article ref={previewRef} className="web-page-preview" aria-label="Fetched page preview">
      <h3>{source.title}</h3><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
      <p>Fetched {new Date(source.fetched_at).toLocaleString()}{source.published_at ? ' · Page publication date: ' + source.published_at : ''}</p>
      {source.requested_url !== source.url && <p>Requested address: {source.requested_url}</p>}
      <p className="web-description-label">{source.description_kind === 'page_metadata' ? 'Page description supplied by the publisher' : 'Excerpt from the fetched page'}</p>
      <p>{source.description || 'No text description was available.'}</p>
      {!!source.images?.length && <WebImageReader key={source.id} images={source.images} sourceFor={image => webImageUrl(image.src)} />}
      {!!source.image_warnings?.length && <details><summary>Image notes</summary>{source.image_warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
      <details><summary>Read captured text ({source.char_count.toLocaleString()} characters{source.truncated ? ', truncated' : ''})</summary><pre className="web-captured-text">{source.text}</pre></details>
      <button type="button" disabled={busy || !!job || isGenerating} onClick={openChat}>{saved[source.id] ? 'Open saved source chat' : 'Save source in new chat'}</button>
      <p>The saved chat receives up to 6,000 characters and an image attachment when available. Image pixels are not automatically read by the model.</p>
    </article>}
  </section>;
}
