import {useEffect, useRef, useState} from 'react';
import {webSystem} from '../webSystem';

export const providerName = value => ({brave: 'Brave', searxng: 'SearXNG', wikipedia: 'Wikipedia (encyclopedia only)'}[value] || value);

export default function SearchProviderSettings({config, onSaved, disabled=false}) {
  const [draft, setDraft] = useState({provider:'wikipedia', endpoint:''});
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => {if (config) setDraft({provider:config.provider, endpoint:config.endpoint || ''});}, [config]);
  async function save(clear=false) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await webSystem('/search', {...draft, ...(key && !clear ? {api_key:key} : {}), clear_api_key:clear}, 'PUT');
      setKey(''); onSaved(result); setMessage(clear ? 'Session key removed.' : 'Search provider saved.');
    } catch (e) {setError(e.message);}
    finally {submitting.current = false; setBusy(false);}
  }
  return <details className="web-provider-settings"><summary>Search provider settings</summary>
    <fieldset disabled={disabled || busy || !config}>
      <div className="web-toolbar">
        <label>Search provider<select aria-label="Search provider" value={draft.provider} onChange={e => setDraft(v => ({...v, provider:e.target.value}))}>
          <option value="brave">Brave (general web, API key)</option><option value="searxng">SearXNG (general web, JSON endpoint)</option><option value="wikipedia">Wikipedia (encyclopedia only)</option>
        </select></label>
        {draft.provider === 'searxng' && <label>Public HTTPS JSON search endpoint<input aria-label="Public JSON search endpoint" type="url" value={draft.endpoint} maxLength={2000} onChange={e => setDraft(v => ({...v, endpoint:e.target.value}))} placeholder="https://search.example.com/search" /></label>}
        {draft.provider === 'brave' && <label>Brave API key<input aria-label="Brave API key" type="password" autoComplete="off" maxLength={512} value={key} onChange={e => setKey(e.target.value)} placeholder={config?.key_configured ? 'Configured; leave blank to keep' : 'Enter a Web Search API key'} /></label>}
        <button type="button" onClick={() => save()}>{busy ? 'Saving…' : 'Save search provider'}</button>
        {config?.key_source === 'session' && <button type="button" onClick={() => save(true)}>Remove session key</button>}
      </div>
    </fieldset>
    <p>Only your search query is sent to the selected provider. Brave requires your own API subscription; SearXNG must have JSON enabled. Wikipedia has encyclopedia-only coverage.</p>
    {draft.provider === 'brave' && <p>A key entered here lasts until the backend closes. For setup across restarts, set the local LAW_BRAVE_SEARCH_API_KEY environment variable before launching the app. The key is never returned to this interface or stored in search settings.{config?.key_source === 'environment' ? ' An environment key is configured.' : ''}</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </details>;
}
