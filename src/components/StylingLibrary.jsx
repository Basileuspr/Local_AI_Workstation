import { useEffect, useRef, useState } from 'react';
import { downloadBlob } from '../downloadBlob';
import { filterStylingExamples, stylingCategories, stylingExamples, stylingExampleCSS, stylingExampleDocument } from '../stylingLibrary';
import './StylingLibrary.css';

function ExampleCode({ example, theme, motion, onClose, onEdit }) {
  const dialog = useRef(null);
  const [language, setLanguage] = useState('html');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const css = stylingExampleCSS(example, theme);
  const fullDocument = stylingExampleDocument(example, { theme });
  const source = language === 'html' ? example.html : css;

  useEffect(() => {
    const node = dialog.current;
    if (!node.open) node.showModal();
  }, []);

  async function copy(text, label) {
    setNotice(''); setError('');
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copied.`);
    } catch {
      setError('Could not copy automatically. Select the code below and copy it with Ctrl+C.');
    }
  }

  return <dialog ref={dialog} className="sl-code-dialog" aria-label={`${example.title} code`} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
    <header><div><span className="sl-category-label">{example.category}</span><h2>{example.title}</h2></div>
      <button type="button" aria-label="Close example code" onClick={() => dialog.current.close()}>Close</button></header>
    <p>{example.description}</p>
    <iframe className="sl-detail-preview" title={`${example.title} enlarged preview`} sandbox="" referrerPolicy="no-referrer"
      srcDoc={stylingExampleDocument(example, { theme, motion })} />
    <div className="sl-code-actions">
      <button type="button" onClick={() => copy(fullDocument, 'Full HTML example')}>Copy full example</button>
      <button type="button" onClick={() => { downloadBlob(new Blob([fullDocument], { type: 'text/html;charset=utf-8' }), `${example.id}.html`); setError(''); setNotice('HTML example download started.'); }}>Save HTML example</button>
      {onEdit && <button type="button" onClick={() => { dialog.current.close(); onEdit({ kind: 'css', text: css, html: example.html, url: `Styling Library · ${example.title}` }); }}>Edit in CSS / Styling</button>}
    </div>
    <div className="sl-code-toolbar">
      <div className="sl-code-tabs" role="tablist" aria-label="Example source">
        {['html', 'css'].map(kind => <button key={kind} id={`sl-tab-${kind}`} type="button" role="tab" aria-selected={language === kind}
          aria-controls="sl-source" tabIndex={language === kind ? 0 : -1} onClick={() => setLanguage(kind)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'html' : event.key === 'End' ? 'css' : kind === 'html' ? 'css' : 'html';
            setLanguage(next); dialog.current.querySelector(`#sl-tab-${next}`).focus();
          }}>{kind.toUpperCase()}</button>)}
      </div>
      <button type="button" onClick={() => copy(source, language.toUpperCase())}>Copy {language.toUpperCase()}</button>
    </div>
    <div id="sl-source" className="sl-source" role="tabpanel" aria-labelledby={`sl-tab-${language}`} tabIndex="0"><pre><code>{source}</code></pre></div>
    <div className="sl-copy-feedback" aria-live="polite">{notice && <span role="status">{notice}</span>}{error && <span role="alert">{error}</span>}</div>
  </dialog>;
}

export default function StylingLibrary({ active = true, onEdit }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [theme, setTheme] = useState('dark');
  const [motion, setMotion] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const examples = filterStylingExamples({ query, category });

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (!active) setSelected(null); }, [active]);

  return <section className="styling-library" aria-label="Styling Library">
    <header className="sl-heading"><div><span className="sl-category-label">DESIGN EXAMPLES</span><h1>Styling Library</h1>
      <p>Explore a look. See how it works. Make it your own.</p></div><span className="sl-offline-label">{stylingExamples.length} offline examples</span></header>
    <div className="sl-toolbar">
      <label className="sl-search"><span>Find an example</span><input type="search" placeholder="Buttons, gradients, loading…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label><span>Preview theme</span><select value={theme} onChange={event => setTheme(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <button type="button" disabled={reducedMotion} title={reducedMotion ? 'Your device prefers reduced motion.' : 'Pause or play animations in the previews.'}
        onClick={() => setMotion(value => !value)}>{reducedMotion ? 'Motion reduced' : motion ? 'Pause animations' : 'Play animations'}</button>
    </div>
    <nav className="sl-categories" aria-label="Example categories">{['All', ...stylingCategories].map(name => <button key={name} type="button" aria-label={`${name} examples`} aria-pressed={category === name}
      onClick={() => setCategory(name)}>{name}<span>{name === 'All' ? stylingExamples.length : stylingExamples.filter(example => example.category === name).length}</span></button>)}</nav>
    <div className="sl-result-count" role="status">{examples.length} {examples.length === 1 ? 'example' : 'examples'}{category !== 'All' ? ` · ${category}` : ''}</div>
    {examples.length ? <div className="sl-gallery">{examples.map(example => <article className="sl-example" key={example.id}>
      <div className="sl-preview">{active && <iframe title={`${example.title} preview`} sandbox="" referrerPolicy="no-referrer" loading="lazy"
        srcDoc={stylingExampleDocument(example, { theme, motion: motion && !reducedMotion })} />}</div>
      <div className="sl-example-content"><span className="sl-category-label">{example.category}</span><h2>{example.title}</h2><p>{example.description}</p>
        <button type="button" aria-label={`View ${example.title} code`} onClick={() => setSelected(example)}>View code <span aria-hidden="true">↗</span></button></div>
    </article>)}</div> : <div className="sl-empty"><h2>No matching examples</h2><p>Try another word or browse a different category.</p><button type="button" onClick={() => { setQuery(''); setCategory('All'); }}>Clear filters</button></div>}
    {selected && active && <ExampleCode key={selected.id} example={selected} theme={theme} motion={motion && !reducedMotion} onClose={() => setSelected(null)} onEdit={onEdit} />}
  </section>;
}
