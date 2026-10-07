import { useState } from 'react';
import { documentReferences, goToReference, saveBookmark, removeBookmark } from '../documentReferences';

export function ReferencesRibbon({ editor, disabled, openDialog, Group, Button }) {
  const refs = documentReferences(editor.state.doc), href = editor.getAttributes('link').href || '';
  return <>
    <Group name="Table of Contents"><Button label="Table of contents settings" disabled={disabled} onClick={() => openDialog('Table of contents', refs.toc ? { ...refs.toc.node.attrs } : { title: 'Contents', maxLevel: 3 })}>▤ Table of contents…</Button>
      <Button label="Remove table of contents" disabled={disabled || !refs.toc} onClick={() => openDialog('Remove table of contents')}>Remove contents</Button><span className="de-shortcut">Heading levels 1–3 · live updates</span></Group>
    <Group name="Links & Bookmarks"><Button label="Manage bookmarks" onClick={() => openDialog('Bookmarks')}>⌑ Bookmarks…</Button>
      <Button label="Insert internal document link" disabled={disabled} onClick={() => openDialog('Hyperlink', { mode: 'document', href: href.startsWith('#') ? href : '', text: '' })}>Link within document…</Button>
      <Button label="Go to linked destination" disabled={!href.startsWith('#') || !refs.targets.has(href.slice(1))} onClick={() => goToReference(editor, href.slice(1))}>Go to link</Button></Group>
    <Group name="Check"><Button label="Check internal links" onClick={() => openDialog('Check internal links')}>Check internal links{refs.broken.length ? ` (${refs.broken.length})` : ''}</Button><span className="de-shortcut">Ctrl+click an internal link to follow it</span></Group>
    <Group name="Upcoming pieces"><span className="de-shortcut">Captions · index · page references<br/>Pagination and print follow</span></Group>
  </>;
}

export function ContentsFields({ fields, setFields }) {
  return <><label>Contents title<input autoFocus required maxLength={100} value={fields.title} onChange={event => setFields({ ...fields, title: event.target.value, invalid: '' })}/></label>
    <label>Include heading levels<select value={fields.maxLevel} onChange={event => setFields({ ...fields, maxLevel: Number(event.target.value) })}><option value={1}>Heading 1</option><option value={2}>Headings 1–2</option><option value={3}>Headings 1–3</option></select></label>
    <p>The entries update as you edit headings, including custom heading styles. Click an entry to jump to it. One table of contents is supported per document.</p>
    <p>DOCX export includes the current entries and working links. It has no page numbers or Word TOC field. Reopening this editor's DOCX restores live contents.</p>
    {fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}

export function BookmarkFields({ editor, disabled }) {
  const [name, setName] = useState(''), [previous, setPrevious] = useState(''), [error, setError] = useState('');
  const { bookmarks, links } = documentReferences(editor.state.doc);
  const save = () => {
    try { saveBookmark(editor, name.trim(), previous); setName(''); setPrevious(''); setError(''); }
    catch (failure) { setError(failure.message); }
  };
  return <><p>Bookmarks mark a cursor position. Adding one keeps selected text; renaming one updates its internal links. Changes can be undone.</p>
    <div className="de-bookmark-add"><label>Bookmark name<input disabled={disabled} maxLength={40} value={name} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }}/></label>
      <button type="button" disabled={disabled || !name.trim()} onClick={save}>{previous ? 'Rename bookmark' : 'Add bookmark'}</button>
      {previous && <button type="button" onClick={() => { setPrevious(''); setName(''); setError(''); }}>Cancel rename</button>}</div>
    {error && <p role="alert">{error}</p>}
    <p className="de-shortcut">Start with a letter; use letters, numbers and underscores. Up to 40 characters and 100 bookmarks.</p>
    <ul className="de-bookmarks">{bookmarks.map(item => <li key={item.name}><strong>{item.name}</strong><span>Links: {links.filter(link => link.href === '#' + item.name).length}</span>
      <button type="button" aria-label={`Go to bookmark ${item.name}`} onClick={() => goToReference(editor, item.name)}>Go to</button>
      <button type="button" disabled={disabled} aria-label={`Rename bookmark ${item.name}`} onClick={() => { setName(item.name); setPrevious(item.name); setError(''); }}>Rename</button>
      <button type="button" disabled={disabled} aria-label={`Delete bookmark ${item.name}`} onClick={() => { removeBookmark(editor, item.name); if (previous === item.name) { setPrevious(''); setName(''); } }}>Delete</button></li>)}</ul>
    {!bookmarks.length && <p>No bookmarks yet. Place the cursor in a paragraph, then add a bookmark.</p>}
    <p>Deleting a bookmark keeps its text. Links to it will be flagged by Check internal links until you retarget them or undo the deletion.</p></>;
}

export function HyperlinkFields({ editor, fields, setFields }) {
  const refs = documentReferences(editor.state.doc), internal = fields.mode === 'document';
  const targets = [...refs.bookmarks.map(item => ({ ...item, label: `Bookmark: ${item.name}` })), ...refs.headings.map(item => ({ ...item, label: `Heading ${item.level}: ${item.text}` }))];
  // Retain links to former headings (now ordinary paragraphs) in the edit picker.
  if (fields.href?.startsWith('#') && !targets.some(item => '#' + item.name === fields.href)) {
    const existing = refs.targets.get(fields.href.slice(1));
    if (existing) targets.push({ ...existing, label: `Paragraph: ${existing.text}` });
  }
  return <><label>Link to<select value={internal ? 'document' : 'web'} onChange={event => setFields({ ...fields, mode: event.target.value, href: event.target.value === 'document' ? '' : 'https://', invalid: '' })}><option value="web">Web page or email</option><option value="document">Place in this document</option></select></label>
    {internal ? <label>Destination<select required value={fields.href || ''} onChange={event => setFields({ ...fields, href: event.target.value, invalid: '' })}><option value="" disabled>Choose a heading or bookmark…</option>
      {fields.href && !refs.targets.has(fields.href.slice(1)) && <option value={fields.href}>Missing: {fields.href.slice(1)}</option>}
      {targets.map(item => <option key={item.name} value={'#' + item.name}>{item.label}</option>)}</select></label> :
      <label>Address<input required maxLength={2048} value={fields.href || ''} onChange={event => setFields({ ...fields, href: event.target.value, invalid: '' })}/></label>}
    {editor.state.selection.empty && !editor.isActive('link') && <label>Text to display (optional)<input maxLength={1000} value={fields.text || ''} onChange={event => setFields({ ...fields, text: event.target.value })}/></label>}
    {internal && !targets.length && <p>Add a heading or bookmark before creating an internal link.</p>}
    <p>Selected text is kept. Use Ctrl+click to follow an internal link, or References → Go to link. Link text stays as entered when the destination's text changes.</p>
    {fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}

export function InternalLinkCheck({ editor, onClose }) {
  const { links, broken } = documentReferences(editor.state.doc);
  return <><p>{broken.length ? `${broken.length} internal ${broken.length === 1 ? 'link has a missing destination' : 'links have missing destinations'}.` : links.length ? `${links.length} internal ${links.length === 1 ? 'link has' : 'links have'} a destination.` : 'There are no internal links to check yet.'}</p>
    <p>This checks internal destinations only. Web pages and email addresses are not contacted.</p>
    <ul className="de-broken-links">{broken.map(link => <li key={link.pos}><strong>{link.text}</strong><span>Missing: {link.href.slice(1)}</span><button type="button" onClick={() => { onClose(); editor.chain().focus().setTextSelection({ from: link.pos, to: link.pos + link.size }).scrollIntoView().run(); }}>Select link</button></li>)}</ul>
    {!!broken.length && <p>Select a link, then use Insert → Link to choose another destination, or Unlink to keep plain text.</p>}</>;
}
