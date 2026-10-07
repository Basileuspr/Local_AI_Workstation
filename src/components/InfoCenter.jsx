import { useRef, useState } from 'react';
import { featureCategories, featureDirectory, filterFeatures } from '../featureUseCases';
import { WorkspaceHelpContent } from './WorkspaceInfo';
import './InfoCenter.css';

export default function InfoCenter({ onOpenWorkspace }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const search = useRef(null);
  const features = filterFeatures(query, category);
  function reset() { setQuery(''); setCategory('all'); search.current?.focus(); }

  return <section className="info-center" aria-labelledby="info-center-title">
    <header className="info-center-heading">
      <span className="info-center-eyebrow">LOCAL AI WORKSTATION · FEATURE GUIDE</span>
      <h1 id="info-center-title">Info Center</h1>
      <p>What would you like to do? Explore use cases for every feature, try an example, or open a workspace to get started.</p>
    </header>
    <div className="info-center-filters" role="search" aria-label="Feature directory">
      <label className="info-center-search">Search features and use cases
        <input ref={search} type="search" value={query} placeholder="Try: summarize, duplicates, transcript, citations…"
          onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
      </label>
      <label>Category<select value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All categories</option>
        {featureCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {(query || category !== 'all') && <button type="button" onClick={reset}>Clear filters</button>}
    </div>
    <p className="info-center-count" role="status">{features.length} of {featureDirectory.length} features{query || category !== 'all' ? ' match your filters' : ' · use cases, examples, and control guides'}</p>
    {!features.length && <div className="info-center-empty"><h2>No matching features</h2><p>Try a broader task, a feature name, or another category.</p><button type="button" onClick={reset}>Show all features</button></div>}
    {featureCategories.map(group => {
      const items = features.filter(feature => feature.category === group.id);
      if (!items.length) return null;
      return <section className="info-center-group" key={group.id} aria-labelledby={`info-group-${group.id}`}>
        <h2 id={`info-group-${group.id}`}>{group.label}<span>{items.length}</span></h2>
        <div className="info-center-grid">{items.map(feature => <article className="info-center-card" key={feature.id}>
          <header><h3>{feature.title}</h3><button type="button" className="info-center-open" aria-label={`Open ${feature.title}`} onClick={() => onOpenWorkspace(feature.id)}>Open ↗</button></header>
          <p>{feature.purpose}</p>
          <h4>Use it to</h4><ul>{feature.useCases.map(useCase => <li key={useCase}>{useCase}</li>)}</ul>
          <div className="info-center-example"><h4>Try this</h4><p>{feature.example}</p></div>
          <button type="button" className="info-center-guide-button" aria-expanded={expanded === feature.id} aria-controls={`info-guide-${feature.id}`}
            onClick={() => setExpanded(current => current === feature.id ? null : feature.id)}>{expanded === feature.id ? 'Hide' : 'Show'} controls &amp; detailed guide<span className="info-center-sr-only"> for {feature.title}</span></button>
          <div id={`info-guide-${feature.id}`} hidden={expanded !== feature.id}>{expanded === feature.id && <WorkspaceHelpContent tab={feature.id} />}</div>
        </article>)}</div>
      </section>;
    })}
  </section>;
}
