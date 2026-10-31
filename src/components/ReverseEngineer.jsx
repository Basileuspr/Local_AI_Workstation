import { useEffect, useRef, useState } from 'react';
import { filterReverseTools, loadReverseLinks, REVERSE_ENGINEER_KEY, reverseCategories, reverseTools, saveReverseLinks } from '../reverseEngineer';
import './ReverseEngineer.css';

export default function ReverseEngineer({ active = true }) {
  const [saved, setSaved] = useState(loadReverseLinks);
  const [installed, setInstalled] = useState({ tools: {} });
  const [checking, setChecking] = useState(false), [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [linkedOnly, setLinkedOnly] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const refreshId = useRef(0);
  const desktop = globalThis.window?.workstationDesktop;
  const canLaunch = typeof desktop?.chooseProgram === 'function' && typeof desktop?.openProgram === 'function';
  async function refreshInstalled() {
    const request = ++refreshId.current;
    if (!desktop?.reverseEngineerInstallations) { setInstalled({ tools: {} }); return; }
    setChecking(true);
    try {
      const result = await desktop.reverseEngineerInstallations();
      if (request === refreshId.current) setInstalled(result?.tools ? result : { tools: {}, error: result?.error || 'Installed tools could not be checked.' });
    } catch { if (request === refreshId.current) setInstalled({ tools: {}, error: 'Installed tools could not be checked. Refresh to retry.' }); }
    finally { if (request === refreshId.current) setChecking(false); }
  }
  useEffect(() => {
    if (active) { setSaved(loadReverseLinks()); refreshInstalled(); }
    return () => { refreshId.current++; };
  }, [active]);
  useEffect(() => {
    const refresh = event => { if (event.key === null || event.key === REVERSE_ENGINEER_KEY) setSaved(loadReverseLinks()); };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  async function act(tool, action) {
    if (lock.current) return;
    lock.current = true; setBusy(tool.id); setError(''); setNotice('');
    try {
      // Reload before mutation so a second pane cannot replace newer links.
      const current = loadReverseLinks();
      if (current.error) throw new Error(current.error);
      if (action === 'open') {
        if (!canLaunch) throw new Error('Open the Windows desktop app to launch local tools.');
        let link = current.links[tool.id];
        if (!link && desktop.reverseEngineerInstallations) {
          const fresh = await desktop.reverseEngineerInstallations();
          setInstalled(fresh?.tools ? fresh : { tools: {}, error: fresh?.error });
          if (fresh?.error) throw new Error(fresh.error);
          const installation = fresh?.tools?.[tool.id];
          if (!installation?.available) throw new Error('Installation files are missing. Restore the installation or choose a different program.');
          link = installation;
        }
        if (!link) throw new Error('Choose a program for this tool first.');
        const result = await desktop.openProgram(link.id);
        if (result?.error) throw new Error(result.error);
        if (!result?.ok) throw new Error('The desktop did not confirm the launch request.');
        setNotice(`Launch requested for ${tool.name}.`);
      } else {
        let selected;
        if (action === 'choose') {
          if (!canLaunch) throw new Error('Open the Windows desktop app to link local tools.');
          selected = await desktop.chooseProgram();
          if (selected?.error) throw new Error(selected.error);
          if (!selected) return;
        }
        const latest = loadReverseLinks();
        if (latest.error) throw new Error(latest.error);
        const next = { ...latest.links };
        if (action === 'choose') next[tool.id] = selected;
        else delete next[tool.id];
        setSaved({ links: saveReverseLinks(next), error: '' });
        setNotice(action === 'choose' ? `${tool.name} launcher saved.` : installed.tools[tool.id]?.available
          ? `${tool.name} now uses the installed version.` : `${tool.name} launcher unlinked. The program remains installed.`);
      }
    } catch (failure) { setError(failure.message || 'The tool action could not be completed.'); }
    finally { lock.current = false; setBusy(''); }
  }

  const links = { ...Object.fromEntries(Object.entries(installed.tools).filter(([, item]) => item.available)), ...saved.links };
  const matches = filterReverseTools(query, category, linkedOnly, links).filter(tool => !selectedId || tool.id === selectedId);
  function resetFilters() { setQuery(''); setCategory(''); setLinkedOnly(false); setSelectedId(''); }
  return <section className="reverse-engineer" aria-labelledby="reverse-engineer-heading">
    <header className="re-heading"><div><span className="re-eyebrow">CODE · STRUCTURE · BEHAVIOR</span><h1 id="reverse-engineer-heading">Reverse Engineer</h1>
      <p>Five free tools, each with a different job. Pick what you want to learn, then follow the first steps.</p></div>
      <span className="re-total">{reverseTools.length} tools <span>· {Object.keys(links).length} linked</span></span>
    </header>
    <div className="re-start"><strong>What do you want to do?</strong><p>Reading a file? Start with Ghidra, dnSpyEx or JADX. Watching a program run? Use x64dbg. Frida is for scripted tracing once you know the basics.</p>
      <div className="re-tasks">{reverseTools.map(tool => <button type="button" key={tool.id} aria-pressed={selectedId === tool.id}
        onClick={() => { resetFilters(); setSelectedId(selectedId === tool.id ? '' : tool.id); }}><span>{tool.task}</span><strong>{tool.name} →</strong></button>)}</div>
    </div>
    <div className="re-filters" role="search" aria-label="Find a reverse-engineering tool">
      <label>Search tools<input type="search" value={query} placeholder="Name, purpose, platform…" onChange={event => setQuery(event.target.value)} /></label>
      <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{reverseCategories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="re-linked-filter"><input type="checkbox" checked={linkedOnly} onChange={event => setLinkedOnly(event.target.checked)} />Linked only</label>
      {(query || category || linkedOnly || selectedId) && <button type="button" onClick={resetFilters}>Clear filters</button>}
    </div>
    <div className="re-install-status"><p className="re-count">{matches.length} of {reverseTools.length} tools · Launch opens a separate window. Choose the file or process inside that tool.</p>
      <button type="button" disabled={!desktop?.reverseEngineerInstallations || checking || !!busy} onClick={refreshInstalled}>{checking ? 'Checking…' : 'Refresh installed tools'}</button></div>
    {!canLaunch && <p className="re-note">Open the Windows desktop app to choose and launch local programs. Tool guides and official links are available here.</p>}
    {saved.error && <div className="re-error" role="alert">{saved.error} <button type="button" onClick={() => setSaved(loadReverseLinks())}>Retry saved launchers</button></div>}
    {error && <p className="re-error" role="alert">{error}</p>}
    {installed.error && <p className="re-error" role="alert">{installed.error}</p>}
    <p className="re-status" role="status" aria-live="polite">{busy ? 'Waiting for the desktop action…' : notice}</p>
    {!matches.length && <div className="re-empty"><h2>No matching tools</h2><p>Try another search or clear the filters to see all five tools.</p><button type="button" onClick={resetFilters}>Show all tools</button></div>}
    <div className="re-grid">{matches.map(tool => {
      const custom = saved.links[tool.id], installation = installed.tools[tool.id], link = links[tool.id];
      return <article key={tool.id} className="re-card" aria-labelledby={`re-title-${tool.id}`} data-re-tool={tool.id}>
        <div className="re-card-meta"><span>{tool.category}</span><span className={link ? 're-is-linked' : ''}>{custom ? 'Custom launcher' : installation?.available ? `Installed · ${installation.version}` : installation ? 'Installation missing' : 'Not linked on this desktop'}</span></div>
        <h2 id={`re-title-${tool.id}`}>{tool.name}</h2><p className="re-kind">{tool.kind}</p>
        <span className="re-level">{tool.level}</span><p>{tool.description}</p>
        <p className="re-best"><strong>Use it for</strong>{tool.bestFor}</p><p className="re-best"><strong>Example</strong>{tool.example}</p>
        <div className="re-platforms">{tool.files}<span>{tool.license}</span></div>
        <p className="re-launch-explainer">{tool.launch}</p>
        <details className="re-guide" open={selectedId === tool.id || undefined}><summary>Your first steps in {tool.name}</summary>
          <ol>{tool.steps.map(step => <li key={step}>{step}</li>)}</ol><p><strong>What you will get: </strong>{tool.outcome}</p><p>{tool.note}</p></details>
        <div className="re-launcher"><span title={link?.name}>{link ? link.name : 'Choose an installed .exe or Windows .lnk shortcut'}</span>
          {installation && !installation.available && !custom && <p className="re-note">{installation.detail}</p>}
          <div className="re-actions"><button type="button" className="re-launch" disabled={!canLaunch || !link || !!busy || !!saved.error} aria-label={`Launch ${tool.name}`} onClick={() => act(tool, 'open')}>Launch</button>
          </div>
          <details className="re-manage"><summary>Launcher settings<span className="re-sr-only"> for {tool.name}</span></summary><p>Installed tools are linked automatically on this desktop. You can optionally choose another .exe or Windows shortcut.</p><div className="re-actions">
            <button type="button" disabled={!canLaunch || !!busy || !!saved.error} aria-label={`Choose program for ${tool.name}`} onClick={() => act(tool, 'choose')}>{link ? 'Change program…' : 'Choose program…'}</button>
            {custom && <button type="button" disabled={!!busy || !!saved.error} aria-label={`Unlink ${tool.name}`} onClick={() => act(tool, 'unlink')}>{installation?.available ? 'Use installed version' : 'Unlink'}</button>}
          </div></details>
        </div>
        <div className="re-links"><a href={tool.docs} target="_blank" rel="noopener noreferrer" aria-label={`Documentation for ${tool.name}`}>Official guide ↗</a><a href={tool.website} target="_blank" rel="noopener noreferrer" aria-label={`Official downloads for ${tool.name}`}>Downloads ↗</a></div>
      </article>;
    })}</div>
  </section>;
}
