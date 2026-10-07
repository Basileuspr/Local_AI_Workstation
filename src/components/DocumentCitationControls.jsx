import { useEffect, useMemo, useRef, useState } from 'react';
import { CITATION_STYLES, SOURCE_TYPES, SOURCE_FIELDS, emptySource, sourceCatalog, citationStyle, citationsIn, citationContext, citationLabel, sourceAuthors,
  saveSource, removeSource, importSources, setCitationStyle, goToCitation } from '../documentCitations';

export function CitationsRibbon({ editor, disabled, openDialog, Group, Button }) {
  const sources = sourceCatalog(editor.state.doc), { bibliography } = citationsIn(editor.state.doc);
  return <Group name="Citations & Bibliography"><Button label="Insert citation" disabled={disabled || !sources.length} onClick={() => openDialog('Insert citation', { sourceIds: [sources[0].id], mode: 'parenthetical', locator: '', prefix: '', suffix: '' })}>Insert citation…</Button>
    <Button label="Manage citation sources" onClick={() => openDialog('Manage sources')}>Manage sources…</Button>
    <label className="de-citation-style">Style<select aria-label="Citation style" disabled={disabled} value={citationStyle(editor.state.doc)} onChange={event => setCitationStyle(editor, event.target.value)}>{CITATION_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <Button label="Bibliography settings" disabled={disabled} onClick={() => openDialog('Bibliography', bibliography ? { title: bibliography.title, includeUncited: bibliography.includeUncited } : { title: citationStyle(editor.state.doc) === 'apa' ? 'References' : 'Bibliography', includeUncited: false })}>Bibliography…</Button>
    <Button label="Remove bibliography" disabled={disabled || !bibliography} onClick={() => openDialog('Remove bibliography')}>Remove bibliography</Button>
    <span className="de-shortcut">{sources.length}/100 document sources · updates locally</span>
  </Group>;
}

function AuthorFields({ authors, onChange, disabled }) {
  return <fieldset className="de-source-authors" disabled={disabled}><legend>Authors (optional)</legend>{authors.map((author, index) => <div className="de-source-author" key={index}>
    <label>Author {index + 1} type<select aria-label={`Author ${index + 1} type`} value={author.literal !== undefined ? 'organization' : 'person'} onChange={event => onChange(authors.map((value, i) => i === index ? event.target.value === 'organization' ? { literal: '' } : { family: '', given: '' } : value))}><option value="person">Person</option><option value="organization">Organization</option></select></label>
    {author.literal !== undefined ? <label>Organization<input aria-label={`Author ${index + 1} organization`} maxLength={120} value={author.literal} onChange={event => onChange(authors.map((value, i) => i === index ? { literal: event.target.value } : value))}/></label> : <>
      <label>Family name<input aria-label={`Author ${index + 1} family name`} maxLength={120} value={author.family} onChange={event => onChange(authors.map((value, i) => i === index ? { ...value, family: event.target.value } : value))}/></label>
      <label>Given names<input aria-label={`Author ${index + 1} given names`} maxLength={120} value={author.given || ''} onChange={event => onChange(authors.map((value, i) => i === index ? { ...value, given: event.target.value } : value))}/></label></>}
    <button type="button" aria-label={`Remove author ${index + 1}`} onClick={() => onChange(authors.filter((_value, i) => i !== index))}>Remove</button>
  </div>)}<button type="button" disabled={authors.length >= 20} onClick={() => onChange([...authors, { family: '', given: '' }])}>Add author</button></fieldset>;
}

export function SourceManager({ editor, disabled }) {
  const [query, setQuery] = useState(''), [draft, setDraft] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const sourceInput = useRef(null), sources = sourceCatalog(editor.state.doc), { citations } = citationsIn(editor.state.doc);
  const visible = sources.filter(source => [source.title, source.year, sourceAuthors(source)].join(' ').toLowerCase().includes(query.toLowerCase()));
  const missing = citations.filter(item => item.sourceIds.some(id => !sources.some(source => source.id === id)));
  const downloadUrl = useMemo(() => URL.createObjectURL(new Blob([JSON.stringify({ version: 1, sources }, null, 2)], { type: 'application/json' })), [sources]);
  useEffect(() => () => URL.revokeObjectURL(downloadUrl), [downloadUrl]);
  const safe = work => { try { work(); setError(''); } catch (failure) { setError(failure.message); } };
  const change = (key, value) => { setDraft({ ...draft, [key]: value }); setError(''); };
  const labels = { title: 'Title', year: 'Year (blank means no date)', publisher: 'Publisher', journal: 'Journal title', volume: 'Volume', issue: 'Issue', pages: 'Page range', siteName: 'Website name', url: 'Source URL', doi: 'DOI', edition: 'Edition (for example 2nd ed.)' };
  const fields = ['title', 'year', ...(draft?.type === 'book' ? ['publisher', 'edition'] : draft?.type === 'article' ? ['journal', 'volume', 'issue', 'pages'] : ['siteName']), 'url', 'doi'];
  return <div className="de-source-manager"><p>Sources are stored with this document and its recovery draft. Save a source list to reuse it in another document.</p>
    <div className="de-source-actions"><button type="button" disabled={disabled || sources.length >= 100} onClick={() => { setDraft(emptySource()); setError(''); }}>Add source</button>
      <a href={downloadUrl} download="Document sources.json">Save source list</a><button type="button" disabled={disabled} onClick={() => sourceInput.current.click()}>Open source list</button></div>
    <input ref={sourceInput} hidden type="file" accept=".json,application/json" aria-label="Choose source list" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      try { if (file.size > 1024 ** 2) throw new Error('Open a source list under 1 MiB.'); const value = JSON.parse(await file.text()); importSources(editor, value); setError(''); setNotice('Source list merged. Existing records and citations were kept. Undo can restore the previous list.'); }
      catch (failure) { setError(failure.message); }
    }}/>
    <label>Search sources<input maxLength={500} value={query} onChange={event => setQuery(event.target.value)}/></label>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {missing.length > 0 && <div className="de-warning"><strong>{missing.length} citations have missing sources.</strong>{missing.map(item => <p key={item.id}><button type="button" onClick={() => goToCitation(editor, item.id)}>Go to {citationLabel(item, citationContext(editor.state.doc))}</button> · close this manager and click the citation to choose its sources.</p>)}</div>}
    <ul className="de-sources">{visible.map(source => {
      const uses = citations.filter(item => item.sourceIds.includes(source.id)).length;
      return <li key={source.id}><div><strong>{source.title}</strong><small>{sourceAuthors(source)} · {source.year || 'No date'} · {uses} citations</small></div>
        <button type="button" disabled={disabled} aria-label={`Edit source ${source.title}`} onClick={() => { setDraft(structuredClone(source)); setError(''); }}>Edit</button>
        <button type="button" disabled={disabled || uses > 0} aria-label={`Delete source ${source.title}`} title={uses ? 'Retarget/remove citations before deleting this source' : 'Delete uncited source; Undo restores it'} onClick={() => safe(() => { removeSource(editor, source.id); if (draft?.id === source.id) setDraft(null); })}>Delete</button></li>;
    })}</ul>{!visible.length && <p>{sources.length ? 'No matching sources.' : 'No sources yet. Add a book, journal article or website.'}</p>}
    {draft && <fieldset className="de-source-form" disabled={disabled}><legend>{sources.some(source => source.id === draft.id) ? 'Edit source' : 'New source'}</legend>
      <label>Source type<select value={draft.type} onChange={event => change('type', event.target.value)}>{SOURCE_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {fields.map(key => <label key={key}>{labels[key]}<input aria-label={`Source ${key}`} maxLength={SOURCE_FIELDS[key]} value={draft[key]} onChange={event => change(key, key === 'doi' ? event.target.value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') : event.target.value)}/></label>)}
      <AuthorFields authors={draft.authors} disabled={disabled} onChange={authors => change('authors', authors)}/>
      <div className="de-source-actions"><button type="button" onClick={() => safe(() => { saveSource(editor, draft); setDraft(null); setNotice('Source saved. Its citations and bibliography updated.'); })}>Save source</button><button type="button" onClick={() => { setDraft(null); setError(''); }}>Cancel source edit</button></div>
    </fieldset>}
    <p className="de-setting-hint">Up to 100 sources, 20 authors per source and 1,000 citations. Basic formats cover the fields shown here; title capitalization is kept as entered. A cited source must be retargeted or uncited before deletion.</p>
  </div>;
}

export function CitationFields({ editor, fields, setFields, disabled }) {
  const sources = sourceCatalog(editor.state.doc), context = citationContext(editor.state.doc);
  return <><fieldset className="de-citation-picker" disabled={disabled}><legend>Choose sources (up to 10)</legend>{sources.map(source => <label key={source.id}><input type="checkbox" checked={fields.sourceIds.includes(source.id)} disabled={!fields.sourceIds.includes(source.id) && fields.sourceIds.length >= 10} onChange={event => setFields({ ...fields, sourceIds: event.target.checked ? [...fields.sourceIds, source.id] : fields.sourceIds.filter(id => id !== source.id), invalid: '' })}/><span>{source.title} <small>— {sourceAuthors(source)}, {source.year || 'n.d.'}</small></span></label>)}</fieldset>
    <fieldset disabled={disabled} className="de-citation-details"><label>Display<select value={fields.mode} onChange={event => setFields({ ...fields, mode: event.target.value })}><option value="parenthetical">Parenthetical</option><option value="narrative">Narrative (author–date, one source)</option></select></label>
      <label>Page or other locator<input maxLength={120} placeholder="p. 12, pp. 12–15, chapter 3…" value={fields.locator} onChange={event => setFields({ ...fields, locator: event.target.value })}/></label>
      <label>Prefix (optional)<input maxLength={120} value={fields.prefix} onChange={event => setFields({ ...fields, prefix: event.target.value })}/></label><label>Suffix (optional)<input maxLength={120} value={fields.suffix} onChange={event => setFields({ ...fields, suffix: event.target.value })}/></label></fieldset>
    <p className="de-citation-preview">Preview: {fields.sourceIds.length ? citationLabel(fields, context) : 'Choose a source'}</p><p>Selected paragraph text stays in place. Source edits and style changes update citations automatically. Locators are printed as entered.</p>
    {fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}

export function BibliographyFields({ fields, setFields }) {
  return <><label>Bibliography title<input required maxLength={100} value={fields.title} onChange={event => setFields({ ...fields, title: event.target.value, invalid: '' })}/></label>
    <label><input type="checkbox" checked={fields.includeUncited} onChange={event => setFields({ ...fields, includeUncited: event.target.checked })}/> Include uncited sources</label><p>Entries update with sources, citations and the selected style. Author–date entries sort by author; numbered entries follow first citation order. One bibliography is supported.</p>
    {fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}
