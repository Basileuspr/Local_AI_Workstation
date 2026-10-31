import { useEffect, useRef, useState } from 'react';
import { filterReverseTools, loadReverseLinks, REVERSE_ENGINEER_KEY, reverseCategories, reverseTools, saveReverseLinks } from '../reverseEngineer';
import './ReverseEngineer.css';

export default function ReverseEngineer({ active = true }) {
  const [saved, setSaved] = useState(loadReverseLinks);
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [linkedOnly, setLinkedOnly] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const desktop = globalThis.window?.workstationDesktop;
  const canLaunch = typeof desktop?.chooseProgram === 'function' && typeof desktop?.openProgram === 'function';
  useEffect(() => {
    if (active) setSaved(loadReverseLinks());
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
        if (!current.links[tool.id]) throw new Error('Choose a program for this tool first.');
        const result = await desktop.openProgram(current.links[tool.id].id);
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
        setNotice(action === 'choose' ? `${tool.name} launcher saved.` : `${tool.name} launcher unlinked. The program remains installed.`);
      }
    } catch (failure) { setError(failure.message || 'The tool action could not be completed.'); }
    finally { lock.current = false; setBusy(''); }
  }

  const matches = filterReverseTools(query, category, linkedOnly, saved.links);
  function resetFilters() { setQuery(''); setCategory(''); setLinkedOnly(false); }
  return <section className="reverse-engineer" aria-labelledby="reverse-engineer-heading">
    <header className="re-heading"><div><span className="re-eyebrow">CODE · STRUCTURE · BEHAVIOR</span><h1 id="reverse-engineer-heading">Reverse Engineer</h1>
      <p>Find the right tool, connect your local installation, and open your analysis workspace.</p></div>
      <span className="re-total">{reverseTools.length} tools <span>· {Object.keys(saved.links).length} linked</span></span>
    </header>
    <div className="re-start"><strong>Choose your starting point</strong><p>Native programs: Ghidra or Binary Ninja. Windows runtime: x64dbg. .NET: ILSpy or dnSpyEx. Android APKs: JADX.</p></div>
    <div className="re-filters" role="search" aria-label="Find a reverse-engineering tool">
      <label>Search tools<input type="search" value={query} placeholder="Name, purpose, platform…" onChange={event => setQuery(event.target.value)} /></label>
      <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{reverseCategories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="re-linked-filter"><input type="checkbox" checked={linkedOnly} onChange={event => setLinkedOnly(event.target.checked)} />Linked only</label>
      {(query || category || linkedOnly) && <button type="button" onClick={resetFilters}>Clear filters</button>}
    </div>
    <p className="re-count">{matches.length} of {reverseTools.length} tools · Local tools open in their own windows. Install them separately using the official links.</p>
    {!canLaunch && <p className="re-note">Open the Windows desktop app to choose and launch local programs. Tool guides and official links are available here.</p>}
    {saved.error && <div className="re-error" role="alert">{saved.error} <button type="button" onClick={() => setSaved(loadReverseLinks())}>Retry saved launchers</button></div>}
    {error && <p className="re-error" role="alert">{error}</p>}
    <p className="re-status" role="status" aria-live="polite">{busy ? 'Waiting for the desktop action…' : notice}</p>
    {!matches.length && <div className="re-empty"><h2>No matching tools</h2><p>Try another search or clear the filters to see all ten tools.</p><button type="button" onClick={resetFilters}>Show all tools</button></div>}
    <div className="re-grid">{matches.map(tool => {
      const link = saved.links[tool.id];
      return <article key={tool.id} className="re-card" aria-labelledby={`re-title-${tool.id}`} data-re-tool={tool.id}>
        <div className="re-card-meta"><span>{tool.category}</span><span className={link ? 're-is-linked' : ''}>{link ? 'Launcher linked' : 'No launcher linked'}</span></div>
        <h2 id={`re-title-${tool.id}`}>{tool.name}</h2><p className="re-kind">{tool.kind}</p>
        <p>{tool.description}</p><p className="re-best"><strong>Use it for</strong>{tool.bestFor}</p>
        <div className="re-platforms">{tool.platforms}<span>{tool.license}</span></div>
        <details><summary>Setup &amp; tool notes<span className="re-sr-only"> for {tool.name}</span></summary><p>{tool.setup}</p><p>{tool.note}</p></details>
        <div className="re-links"><a href={tool.website} target="_blank" rel="noopener noreferrer" aria-label={`Official downloads for ${tool.name}`}>Official downloads ↗</a><a href={tool.docs} target="_blank" rel="noopener noreferrer" aria-label={`Documentation for ${tool.name}`}>Documentation ↗</a></div>
        <div className="re-launcher"><span title={link?.name}>{link ? link.name : 'Choose an installed .exe or Windows .lnk shortcut'}</span>
          <div className="re-actions"><button type="button" className="re-launch" disabled={!canLaunch || !link || !!busy || !!saved.error} aria-label={`Launch ${tool.name}`} onClick={() => act(tool, 'open')}>Launch</button>
            <button type="button" disabled={!canLaunch || !!busy || !!saved.error} aria-label={`Choose program for ${tool.name}`} onClick={() => act(tool, 'choose')}>{link ? 'Change program…' : 'Choose program…'}</button>
            {link && <button type="button" disabled={!!busy || !!saved.error} aria-label={`Unlink ${tool.name}`} onClick={() => act(tool, 'unlink')}>Unlink</button>}
          </div>
        </div>
      </article>;
    })}</div>
  </section>;
}
