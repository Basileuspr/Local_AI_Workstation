import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { apiUrl } from '../api';
import { DOCUMENT_FONTS, DEFAULT_PAGE, EMPTY_DOCUMENT, PLANNED_RIBBONS, documentExtensions, cleanDocumentPaste,
  documentMatches, documentStats, pageDimensions, editorDraft, resetDocumentContent } from '../documentEditor';
import './DocumentEditor.css';
import { PAGE_STORIES, PAGINATION_OPTIONS, pageVariants } from '../documentPageLayout';
import { HeaderFooterFields, PageNumberFields, ParagraphPaginationFields, PageStorySample } from './DocumentPageSettings';
import { tableContext, selectCellRange, setColumnWidths } from '../documentTables';
import { TableLayoutRibbon, TableDesignRibbon, TableWidthFields, TableRangeFields } from './DocumentTableControls';
import { DEFAULT_STYLES, currentStyle, effectiveParagraph, effectiveText, toggleStyleEmphasis, applyParagraphStyle, saveParagraphStyle, removeParagraphStyle } from '../documentStyles';
import { StylesRibbon, StylesPane, ParagraphStyleFields } from './DocumentStyleControls';
import { documentReferences, goToReference, setDocumentLink, saveContents, removeContents } from '../documentReferences';
import { noteSettings, saveNoteSettings, convertNotes } from '../documentNotes';
import { NotesRibbon, NotesPane, NoteNumberFields, DocumentNotesPreview } from './DocumentNoteControls';
import { ReferencesRibbon, ContentsFields, BookmarkFields, HyperlinkFields, InternalLinkCheck } from './DocumentReferenceControls';
import { citationsIn, saveCitation, removeCitation, saveBibliography, removeBibliography } from '../documentCitations';
import { CitationsRibbon, SourceManager, CitationFields, BibliographyFields } from './DocumentCitationControls';

const TABS = ['File', 'Home', 'Diagram', 'Insert', 'Draw', 'Outlining', 'Design', 'Layout', 'References', 'Mailings', 'Review', 'View', 'Developer'];
function Group({ name, children, className = '' }) {
  return <div className={`de-group ${className}`}><div className="de-group-controls">{children}</div><span className="de-group-name">{name}</span></div>;
}
function Button({ children, label, active, onClick, disabled, className = '' }) {
  return <button type="button" className={`de-button ${className}`} title={label} aria-label={label}
    aria-pressed={active} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>;
}
function NumberControl({ label, value, min, max, step = 1, disabled, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input type="number" aria-label={label} min={min} max={max} step={step} value={draft} disabled={disabled}
    onChange={event => setDraft(event.target.value)} onBlur={() => {
      const number = Number(draft);
      if (draft.trim() && Number.isFinite(number) && number >= min && number <= max) { if (number !== value) onCommit(number); }
      else setDraft(String(value));
    }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/>
}
function Dialog({ title, children, onClose, onSubmit, action = 'Apply' }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current.showModal(); ref.current.querySelector('input, textarea, select')?.focus(); return () => previous?.focus?.(); }, []);
  return <dialog ref={ref} className="de-dialog" aria-label={title} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); onSubmit?.(); }}><header><h2>{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}>×</button></header>
      <div className="de-dialog-content">{children}</div><footer><button type="button" onClick={onClose}>{onSubmit ? 'Cancel' : 'Close'}</button>{onSubmit && <button className="de-primary" type="submit">{action}</button>}</footer>
    </form>
  </dialog>;
}
async function conversion(path, options) {
  const response = await fetch(apiUrl(`/document-editor/${path}`), options);
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(typeof value.detail === 'string' ? value.detail : `Document conversion failed (${response.status}).`);
  }
  return response;
}

function RichDocumentEditor({ active }) {
  const [tab, setTab] = useState('Home'), [name, setName] = useState('Untitled document');
  const [layout, setLayout] = useState({ ...DEFAULT_PAGE }), [zoom, setZoom] = useState(85);
  const [storyPreview, setStoryPreview] = useState('default');
  const [stylesOpen, setStylesOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false), [noteId, setNoteId] = useState('');
  function openNote(id) { setNoteId(id); setNotesOpen(true); setStylesOpen(false); }
  const [revision, setRevision] = useState(0), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [draftStatus, setDraftStatus] = useState('');
  const [exported, setExported] = useState(null);
  const [recovery, setRecovery] = useState(null), [draftReady, setDraftReady] = useState(false);
  const [ruler, setRuler] = useState(true), [outline, setOutline] = useState(false), [showMarks, setShowMarks] = useState(false);
  const [spellcheck, setSpellcheck] = useState(true), [readOnly, setReadOnly] = useState(false), [view, setView] = useState('page');
  const [dialog, setDialog] = useState(null), [fields, setFields] = useState({}), [pendingImport, setPendingImport] = useState(null);
  const [findOpen, setFindOpen] = useState(false), [query, setQuery] = useState(''), [replacement, setReplacement] = useState(''), [matchCase, setMatchCase] = useState(false);
  const openInput = useRef(null), pictureInput = useRef(null), scroll = useRef(null), surface = useRef(null), latest = useRef(null), alive = useRef(true);
  const operationLock = useRef(false);
  const [extensions] = useState(documentExtensions);
  const editor = useEditor({
    extensions, content: EMPTY_DOCUMENT, immediatelyRender: false, shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: 'de-prose', 'aria-label': 'Document content', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      transformPastedHTML: cleanDocumentPaste,
      handleDrop: (_view, event) => !!event.dataTransfer?.files?.length,
      handlePaste: (_view, event) => !!event.clipboardData?.files?.length,
    },
    onUpdate: () => { setRevision(value => value + 1); setDirty(true); setNotice(''); },
  });
  latest.current = { name, layout, dirty, editor, active, busy, recovery };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (exported) URL.revokeObjectURL(exported.url); }, [exported]);
  useEffect(() => {
    let mounted = true;
    editorDraft('get').then(value => { if (mounted) { setRecovery(value || null); setDraftReady(true); } })
      .catch(() => { if (mounted) { setDraftReady(true); setDraftStatus('Recovery storage unavailable. Export regularly.'); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!editor || !draftReady || recovery || !dirty) return;
    setDraftStatus('Saving recovery draft…');
    const timer = setTimeout(() => {
      editorDraft('put', { version: 1, name, layout, document: editor.getJSON(), updated: new Date().toISOString() })
        .then(() => { if (alive.current) setDraftStatus('Recovery draft stored locally'); })
        .catch(() => { if (alive.current) setDraftStatus('Recovery draft could not be saved. Export your DOCX.'); });
    }, 800);
    return () => clearTimeout(timer);
  }, [editor, draftReady, recovery, dirty, revision, name, layout]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(draftReady && !busy && !readOnly && !recovery, false);
    editor.view.dom.setAttribute('spellcheck', String(spellcheck));
  }, [editor, busy, readOnly, spellcheck, recovery, draftReady]);
  useEffect(() => {
    const warn = event => { if (latest.current.dirty) { event.preventDefault(); event.returnValue = 'Export your document before closing.'; } };
    const keys = event => {
      const state = latest.current;
      if (!state.active || !state.editor || state.busy || state.recovery || !surface.current?.contains(event.target) || document.querySelector('.de-dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && ['s', 'f', 'h'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.key.toLowerCase() === 's') exportDocument(); else setFindOpen(true);
      }
    };
    window.addEventListener('beforeunload', warn); window.addEventListener('keydown', keys);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('keydown', keys); };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const open = event => openNote(event.detail.id);
    editor.view.dom.addEventListener('document-note-open', open);
    return () => editor.view.dom.removeEventListener('document-note-open', open);
  }, [editor]);

  async function task(work) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true); setError('');
    try { await work(); } catch (failure) { setError(failure.message || 'Document operation failed. Your current draft is still available.'); }
    finally { operationLock.current = false; if (alive.current) setBusy(false); }
  }
  function changed() { setDirty(true); setRevision(value => value + 1); setNotice(''); }
  function changeLayout(patch) { setLayout(value => ({ ...value, ...patch })); changed(); }
  function applyParagraph(patch) {
    if (!editor || readOnly) return;
    editor.chain().focus().updateAttributes('paragraph', patch).updateAttributes('heading', patch).run();
  }
  function openDialog(kind, initial = {}) { setFields(initial); setDialog(kind); }
  useEffect(() => {
    if (!editor) return;
    const open = event => { const item = citationsIn(editor.state.doc).citations.find(item => item.id === event.detail.id); if (item) openDialog('Edit citation', { ...item.node.attrs }); };
    editor.view.dom.addEventListener('document-citation-open', open);
    return () => editor.view.dom.removeEventListener('document-citation-open', open);
  }, [editor]);
  function commitStyle() {
    try {
      const style = Object.fromEntries(Object.keys(DEFAULT_STYLES[0]).map(key => [key, fields[key]]));
      for (const key of ['fontSize', 'indent', 'spaceBefore', 'spaceAfter', 'lineSpacing', 'level']) style[key] = Number(style[key]);
      saveParagraphStyle(editor, style);
      if (dialog === 'Create paragraph style' && fields.apply) applyParagraphStyle(editor, style.id);
      setDialog(null); setNotice(`Style “${style.name.trim()}” saved`);
    } catch (failure) { setFields(previous => ({ ...previous, error: failure.message })); }
  }
  function newDocument() {
    if (dirty) { setDialog('New document'); return; }
    resetDocument();
  }
  function resetDocument() {
    resetDocumentContent(editor, EMPTY_DOCUMENT);
    setName('Untitled document'); setLayout({ ...DEFAULT_PAGE }); setDirty(false); setRevision(0); setNotice('New document');
    setDialog(null); setError(''); setExported(null); setDraftStatus(''); editorDraft('delete').catch(() => setDraftStatus('Previous recovery draft could not be cleared.'));
    setReadOnly(false); setNotesOpen(false); setNoteId(''); setTab('Home'); editor.commands.focus();
  }
  function replaceDocument(value, title) {
    // Reset the editor history so Undo cannot bring a previous file into this one.
    resetDocumentContent(editor, value.document);
    setName(title); setLayout({ ...DEFAULT_PAGE, ...value.layout }); setReadOnly(false); setDirty(true); setRevision(v => v + 1);
    setNotesOpen(false); setNoteId(''); setPendingImport(null); setDialog(null); setRecovery(null); setExported(null); setTab('Home'); setNotice('Editable copy opened');
  }
  async function importDocument(file) {
    if (!file) return;
    await task(async () => {
      if (!/\.docx$/i.test(file.name) || file.size > 24 * 1024 ** 2) throw new Error('Choose a .docx file no larger than 24 MiB.');
      const response = await conversion('import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const value = await response.json();
      setPendingImport({ ...value, name: `${file.name.replace(/\.docx$/i, '')} — edited` }); setDialog('Open editable copy');
    });
  }
  async function exportDocument() {
    await task(async () => {
      const state = latest.current;
      const response = await conversion('export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: state.editor.getJSON(), layout: state.layout }) });
      const title = state.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'Document';
      const url = URL.createObjectURL(await response.blob());
      setExported({ url, name: `${title}.docx` });
      setNotice('DOCX ready. Select Download DOCX to save the exported copy.');
    });
  }
  async function insertPicture(file) {
    if (!file) return;
    await task(async () => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 ** 2) throw new Error('Choose a PNG, JPG or WebP picture under 8 MiB.');
      const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Picture could not be read.')); reader.readAsDataURL(file); });
      const picture = await createImageBitmap(file);
      if (picture.width * picture.height > 24_000_000) { picture.close(); throw new Error('Pictures must be at most 24 megapixels.'); }
      const width = Math.max(24, Math.min(480, picture.width)); picture.close();
      if (documentStats(editor.state.doc).pictures >= 20) throw new Error('This phase supports up to 20 pictures per document.');
      editor.chain().focus().setImage({ src, width, alt: file.name.replace(/\.[^.]+$/, '') }).run();
      setTab('Picture Format');
    });
  }
  function findNext() {
    const matches = documentMatches(editor.state.doc, query, matchCase);
    if (!matches.length) return;
    const match = matches.find(item => item.from >= editor.state.selection.to) || matches[0];
    editor.chain().focus().setTextSelection(match).scrollIntoView().run();
  }
  function replace(all = false) {
    const matches = documentMatches(editor.state.doc, query, matchCase);
    if (!matches.length || readOnly) return;
    const selected = matches.find(m => m.from === editor.state.selection.from && m.to === editor.state.selection.to);
    if (!all && !selected) { findNext(); return; }
    const transaction = editor.state.tr;
    for (const match of (all ? matches : [selected]).slice().reverse()) transaction.insertText(replacement, match.from, match.to);
    editor.view.dispatch(transaction); if (!all) findNext();
    setNotice(`${all ? matches.length : 1} replacement${all && matches.length !== 1 ? 's' : ''}`);
  }
  if (!editor) return <p>Opening Document Editor…</p>;
  const stats = documentStats(editor.state.doc), [pageWidth, pageHeight] = pageDimensions(layout);
  const pa = effectiveParagraph(editor), textStyle = effectiveText(editor);
  const fontPt = Math.round(textStyle.fontSize * 10) / 10;
  const selectedImage = editor.isActive('image'), picture = editor.getAttributes('image');
  const selectedTable = editor.isActive('table'), matches = documentMatches(editor.state.doc, query, matchCase);
  const table = tableContext(editor.state), availableWidth = Math.max(24, (pageWidth - layout.left - layout.right) * 96);
  const tabs = [...TABS, ...(selectedImage ? ['Picture Format'] : []), ...(table ? ['Table Layout', 'Table Design'] : [])];
  const currentTab = (tab === 'Picture Format' && !selectedImage) || (tab.startsWith('Table ') && !table) ? 'Home' : tab;
  const references = documentReferences(editor.state.doc), headings = references.headings;
  const run = command => editor.chain().focus()[command]().run();
  const editDisabled = busy || readOnly || !!recovery || !draftReady;
  const toggle = (label, icon, mark, command) => <Button label={label} active={editor.isActive(mark)} disabled={editDisabled} onClick={() => run(command)}>{icon}</Button>;
  const variants = pageVariants(layout), sampleVariant = variants.some(([key]) => key === storyPreview) ? storyPreview : 'default';
  const hasPageDetails = layout.pageNumbers || PAGE_STORIES.some(key => layout[key]);

  return <section ref={surface} className={`document-editor ${showMarks ? 'de-show-marks' : ''}`} aria-label="Document Editor">
    <header className="de-titlebar"><span className="de-logo" aria-hidden="true">D</span><div><h1>Document Editor <span>Phase 8</span></h1>
      <input aria-label="Document name" maxLength={120} value={name} disabled={busy || !!recovery} onChange={event => { setName(event.target.value); changed(); }}/></div>
      <div className="de-quick"><Button label="Undo (Ctrl+Z)" disabled={editDisabled || !editor.can().undo()} onClick={() => run('undo')}>↶</Button><Button label="Redo (Ctrl+Y)" disabled={editDisabled || !editor.can().redo()} onClick={() => run('redo')}>↷</Button>
        <button className="de-primary" disabled={busy || !!recovery} onClick={exportDocument}>Export .docx</button></div>
    </header>
    <div className="de-tabs" role="tablist" aria-label="Document ribbon">{tabs.map((item, index) => <button key={item} role="tab" id={`de-tab-${item.replace(' ', '-')}`}
      aria-selected={item === currentTab} aria-controls="de-ribbon" tabIndex={item === currentTab ? 0 : -1}
      className={PLANNED_RIBBONS[item] ? 'de-planned-tab' : ''} title={PLANNED_RIBBONS[item] ? `${item}: planned for later phases` : item}
      onClick={() => setTab(item)} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setTab(tabs[next]); event.currentTarget.parentElement.children[next].focus();
      } }}>{item}{PLANNED_RIBBONS[item] && <span className="de-planned-dot" aria-label="planned">·</span>}</button>)}</div>
    <fieldset className="de-ribbon" id="de-ribbon" role="tabpanel" aria-labelledby={`de-tab-${currentTab.replace(' ', '-')}`} disabled={busy || !!recovery}>
      {currentTab === 'File' && <><Group name="Document"><Button label="New blank document" onClick={newDocument}>＋ New</Button><Button label="Open DOCX as an editable copy" onClick={() => openInput.current.click()}>▤ Open .docx</Button><Button label="Export DOCX with Python" onClick={exportDocument}>⇩ Export .docx</Button></Group>
        </>}
      {currentTab === 'Home' && <>
        <Group name="Clipboard" className="de-clipboard-group"><Button label="Select all (Ctrl+A)" onClick={() => editor.chain().focus().selectAll().run()}>Select all</Button><span className="de-shortcut">Ctrl+C Copy · Ctrl+X Cut<br/>Ctrl+V Paste</span></Group>
        <Group name="Font" className="de-font-group"><div className="de-row"><select aria-label="Font family" disabled={editDisabled} value={textStyle.fontFamily || 'Calibri'} onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()}>{DOCUMENT_FONTS.map(font => <option key={font}>{font}</option>)}</select>
          <NumberControl label="Font size in points" min={6} max={96} step={0.5} value={fontPt} disabled={editDisabled} onCommit={value => editor.chain().focus().setFontSize(`${value}pt`).run()}/><span>pt</span></div>
          <div className="de-row"><Button label="Bold (Ctrl+B)" active={textStyle.bold} disabled={editDisabled} onClick={() => toggleStyleEmphasis(editor, 'bold')}><b>B</b></Button><Button label="Italic (Ctrl+I)" active={textStyle.italic} disabled={editDisabled} onClick={() => toggleStyleEmphasis(editor, 'italic')}><i>I</i></Button>{toggle('Underline (Ctrl+U)', <u>U</u>, 'underline', 'toggleUnderline')}{toggle('Strikethrough', <s>ab</s>, 'strike', 'toggleStrike')}
            {toggle('Subscript', <>x<sub>2</sub></>, 'subscript', 'toggleSubscript')}{toggle('Superscript', <>x<sup>2</sup></>, 'superscript', 'toggleSuperscript')}
            <label className="de-color" title="Text color">A<input type="color" aria-label="Text color" disabled={editDisabled} defaultValue="#17202a" onChange={e => editor.chain().focus().setColor(e.target.value).run()}/></label>
            <Button label="Yellow highlight" active={editor.isActive('highlight')} disabled={editDisabled} onClick={() => editor.chain().focus().toggleHighlight({ color: '#FFFF00' }).run()}>▰</Button>
            <Button label="Clear text formatting" disabled={editDisabled} onClick={() => editor.chain().focus().unsetAllMarks().run()}>A×</Button></div>
        </Group>
        <Group name="Paragraph" className="de-paragraph-group"><div className="de-row">{toggle('Bulleted list', '• List', 'bulletList', 'toggleBulletList')}{toggle('Numbered list', '1. List', 'orderedList', 'toggleOrderedList')}
          <Button label="Decrease indent" disabled={editDisabled} onClick={() => editor.isActive('listItem') ? editor.chain().focus().liftListItem('listItem').run() : applyParagraph({ indent: Math.max(0, (pa.indent || 0) - 1) })}>⇤</Button>
          <Button label="Increase indent" disabled={editDisabled} onClick={() => editor.isActive('listItem') ? editor.chain().focus().sinkListItem('listItem').run() : applyParagraph({ indent: Math.min(6, (pa.indent || 0) + 1) })}>⇥</Button>
          <Button label="Show paragraph marks" active={showMarks} onClick={() => setShowMarks(!showMarks)}>¶</Button></div>
          <div className="de-row">{['left', 'center', 'right', 'justify'].map((align, i) => <Button key={align} label={`Align ${align}`} active={pa.textAlign === align} disabled={editDisabled} onClick={() => editor.chain().focus().setTextAlign(align).run()}>{['≡←', '≡', '→≡', '☰'][i]}</Button>)}
            <select aria-label="Line spacing" value={pa.lineSpacing || 1.15} disabled={editDisabled} onChange={e => applyParagraph({ lineSpacing: Number(e.target.value) })}>{[...new Set([1, 1.15, 1.5, 2, 2.5, 3, pa.lineSpacing || 1.15])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{Number(n.toFixed(3))} lines</option>)}</select></div>
        </Group>
        <StylesRibbon editor={editor} disabled={editDisabled} open={stylesOpen} onToggle={() => { setNotesOpen(false); setStylesOpen(!stylesOpen); }} Group={Group} Button={Button}/>
        <Group name="Editing"><Button label="Find text (Ctrl+F)" onClick={() => setFindOpen(true)}>⌕ Find</Button><Button label="Find and replace (Ctrl+H)" onClick={() => setFindOpen(true)}>Replace</Button></Group>
      </>}
      {currentTab === 'Insert' && <>
        <Group name="Header & Footer"><Button label="Edit header and footer" disabled={editDisabled} onClick={() => openDialog('Header and footer', { ...layout })}>Header & Footer</Button><Button label="Page number settings" disabled={editDisabled} active={!!layout.pageNumbers} onClick={() => openDialog('Page numbers', { ...layout })}>Page numbers</Button></Group>
        <Group name="Pages"><Button label="Insert page break" disabled={editDisabled} onClick={() => editor.chain().focus().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run()}>▤ Page break</Button></Group>
        <Group name="Tables"><Button label="Insert table" disabled={editDisabled || selectedTable} onClick={() => openDialog('Insert table', { rows: 3, columns: 3, header: true })}>▦ Table</Button>{table && <Button label="Show table layout tools" onClick={() => setTab('Table Layout')}>Table tools</Button>}</Group>
        <Group name="Illustrations"><Button label="Insert local picture" disabled={editDisabled} onClick={() => pictureInput.current.click()}>▧ Pictures</Button><span className="de-shortcut">PNG · JPG · WebP</span></Group>
        <Group name="Links"><Button label="Insert or edit hyperlink" disabled={editDisabled} onClick={() => { const href = editor.getAttributes('link').href || 'https://'; openDialog('Hyperlink', { href, mode: href.startsWith('#') ? 'document' : 'web', text: '' }); }}>↗ Link</Button><Button label="Manage bookmarks" onClick={() => openDialog('Bookmarks')}>⌑ Bookmark</Button><Button label="Remove hyperlink" disabled={editDisabled || !editor.isActive('link')} onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>Unlink</Button></Group>
        <Group name="Symbols"><Button label="Insert symbol" disabled={editDisabled} onClick={() => openDialog('Insert symbol', { symbol: '©' })}>Ω Symbol</Button></Group>
      </>}
      {currentTab === 'Layout' && <>
        <Group name="Page Setup"><label>Margins<select aria-label="Page margin preset" disabled={editDisabled} value="" onChange={e => { const n = Number(e.target.value); changeLayout({ top: n, bottom: n, left: n, right: n }); }}><option value="" disabled>Choose preset…</option><option value="1">Normal · 1″</option><option value="0.5">Narrow · 0.5″</option><option value="1.5">Wide · 1.5″</option></select></label>
          <label>Orientation<select aria-label="Page orientation" disabled={editDisabled} value={layout.orientation} onChange={e => changeLayout({ orientation: e.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
          <label>Size<select aria-label="Paper size" disabled={editDisabled} value={layout.paper} onChange={e => changeLayout({ paper: e.target.value })}><option>Letter</option><option>A4</option><option>Legal</option></select></label></Group>
        <Group name="Custom margins (inches)"><div className="de-fields">{['top', 'bottom', 'left', 'right'].map(key => <label key={key}>{key}<NumberControl label={`${key} margin in inches`} step={0.05} min={0.25} max={3} disabled={editDisabled} value={layout[key]} onCommit={value => changeLayout({ [key]: value })}/></label>)}</div></Group>
        <Group name="Paragraph spacing (points)"><label>Before<NumberControl label="Paragraph spacing before" min={0} max={72} value={pa.spaceBefore || 0} disabled={editDisabled} onCommit={n => applyParagraph({ spaceBefore: n })}/></label><label>After<NumberControl label="Paragraph spacing after" min={0} max={72} value={pa.spaceAfter ?? 8} disabled={editDisabled} onCommit={n => applyParagraph({ spaceAfter: n })}/></label></Group>
        <Group name="Paragraph pagination"><Button label="Paragraph line and page breaks" disabled={editDisabled} onClick={() => openDialog('Line and page breaks', Object.fromEntries(PAGINATION_OPTIONS.map(([key]) => [key, pa[key] ?? null])))}>Line and page breaks…</Button><span className="de-shortcut">Keep lines together · Keep with next</span></Group>
      </>}
      {currentTab === 'References' && <><CitationsRibbon editor={editor} disabled={editDisabled} openDialog={openDialog} Group={Group} Button={Button}/><NotesRibbon editor={editor} disabled={editDisabled} openDialog={openDialog} onOpen={openNote} Group={Group} Button={Button}/><ReferencesRibbon editor={editor} disabled={editDisabled} openDialog={openDialog} Group={Group} Button={Button}/></>}
      {currentTab === 'Review' && <><Group name="Proofing"><Button label="Show word count" onClick={() => setDialog('Word count')}>Word Count</Button><label><input type="checkbox" checked={spellcheck} onChange={e => setSpellcheck(e.target.checked)}/> Browser spelling</label></Group><Group name="Editing"><label><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)}/> Read only view</label></Group></>}
      {currentTab === 'View' && <>
        <Group name="Views"><Button label="Page-shaped view" active={view === 'page'} onClick={() => setView('page')}>▤ Page view</Button><Button label="Fit flowing view to workspace" active={view === 'flow'} onClick={() => setView('flow')}>▱ Web view</Button></Group>
        <Group name="Show"><label><input type="checkbox" checked={ruler} onChange={e => setRuler(e.target.checked)}/> Ruler</label><label><input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)}/> Navigation pane</label><label><input type="checkbox" checked={showMarks} onChange={e => setShowMarks(e.target.checked)}/> Paragraph marks</label></Group>
        <Group name="Zoom"><Button label="Set zoom to 100 percent" onClick={() => setZoom(100)}>100%</Button><Button label="Fit page width" onClick={() => setZoom(Math.max(40, Math.min(200, Math.floor(((scroll.current?.clientWidth || 900) - 70) / (pageWidth * 96) * 100))))}>Page width</Button></Group>

      </>}
      {currentTab === 'Picture Format' && <><Group name="Size"><label>Width (pixels)<NumberControl label="Picture width in pixels" min={24} max={1600} value={picture.width || 480} disabled={editDisabled} onCommit={width => editor.chain().focus().updateAttributes('image', { width }).run()}/></label><Button label="Fit picture to page" disabled={editDisabled} onClick={() => editor.chain().focus().updateAttributes('image', { width: Math.round((pageWidth - layout.left - layout.right) * 96) }).run()}>Fit to page</Button></Group><Group name="Accessibility"><Button label="Edit picture alt text" disabled={editDisabled} onClick={() => openDialog('Picture description', { alt: picture.alt || '' })}>Alt Text</Button></Group><Group name="Picture"><Button label="Remove selected picture" disabled={editDisabled} onClick={() => run('deleteSelection')}>Remove picture</Button></Group></>}
      {currentTab === 'Table Layout' && table && <TableLayoutRibbon editor={editor} context={table} disabled={editDisabled} available={availableWidth} openDialog={openDialog} Group={Group} Button={Button}/>}
      {currentTab === 'Table Design' && table && <TableDesignRibbon editor={editor} context={table} disabled={editDisabled} Group={Group} Button={Button}/>}
      {PLANNED_RIBBONS[currentTab] && <div role="status">{currentTab} — not implemented</div>}
    </fieldset>
    <input hidden ref={openInput} type="file" accept=".docx" aria-label="Choose DOCX file" onChange={e => { importDocument(e.target.files?.[0]); e.target.value = ''; }}/>
    <input hidden ref={pictureInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose document picture" onChange={e => { insertPicture(e.target.files?.[0]); e.target.value = ''; }}/>
    {error && <div className="de-alert" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {exported && <div className="de-export"><span>Last export: {exported.name}</span><a href={exported.url} download={exported.name}>Download DOCX</a><span>Changes made afterward need another export.</span><button aria-label="Dismiss export download" onClick={() => setExported(null)}>×</button></div>}
    {recovery && <div className="de-recovery"><strong>A local recovery draft is available: {recovery.name || 'Untitled'}</strong><button onClick={() => task(async () => {
      // Validate the recovery model through the same Python contract before rendering it.
      await conversion('export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: recovery.document, layout: recovery.layout }) });
      replaceDocument(recovery, recovery.name || 'Recovered document'); setNotice('Recovery draft restored');
    })}>Restore draft</button><button onClick={() => setDialog('Discard recovery draft')}>Discard draft</button></div>}
    {findOpen && <div className="de-find" role="search" aria-label="Find and replace"><label>Find<input autoFocus maxLength={1000} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } if (e.key === 'Escape') { setFindOpen(false); editor.commands.focus(); } }}/></label><label>Replace with<input maxLength={10000} value={replacement} onChange={e => setReplacement(e.target.value)}/></label><label><input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)}/> Match case</label><span>{matches.length} matches</span><button disabled={!matches.length} onClick={findNext}>Next</button><button disabled={editDisabled || !matches.length} onClick={() => replace()}>Replace</button><button disabled={editDisabled || !matches.length} onClick={() => replace(true)}>Replace all</button><button aria-label="Close find and replace" onClick={() => { setFindOpen(false); editor.commands.focus(); }}>×</button></div>}
    {hasPageDetails && <div className="de-story-toolbar"><label>Header/footer sample<select aria-label="Header/footer sample variant" value={sampleVariant} onChange={event => setStoryPreview(event.target.value)}>{variants.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span>Continuous editing view · page numbers update in the DOCX reader</span></div>}
    <div className="de-work-area">{outline && <aside className="de-outline" aria-label="Document headings"><h2>Navigation</h2>{headings.length ? headings.map(item => <button key={item.pos} style={{ paddingLeft: 10 + (item.level - 1) * 12 }} onClick={() => goToReference(editor, item.name)}>{item.text}</button>) : <p>Apply a heading style to build an outline.</p>}{references.bookmarks.length > 0 && <><h2>Bookmarks</h2>{references.bookmarks.map(item => <button key={item.name} onClick={() => goToReference(editor, item.name)}>⌑ {item.name}</button>)}</>}</aside>}
      <div className={`de-scroll de-view-${view}`} ref={scroll}><div className="de-sheet-wrap" style={view === 'page' ? { zoom: zoom / 100, width: `${pageWidth}in` } : { zoom: zoom / 100 }}>
        {ruler && <div className="de-ruler" aria-label="Horizontal ruler in inches" style={{ paddingLeft: `${layout.left}in`, paddingRight: `${layout.right}in` }}><div>{Array.from({ length: Math.floor(pageWidth - layout.left - layout.right) + 1 }, (_, i) => <span key={i} style={{ left: `${i}in` }}>{i}</span>)}</div></div>}
        <div className="de-paper" style={{ minHeight: view === 'page' ? `${pageHeight}in` : '65vh', padding: view === 'page' ? `${layout.top}in ${layout.right}in ${layout.bottom}in ${layout.left}in` : '32px' }}><PageStorySample layout={layout} variant={sampleVariant} position="header"/><EditorContent editor={editor}/><DocumentNotesPreview editor={editor} onOpen={openNote}/><PageStorySample layout={layout} variant={sampleVariant} position="footer"/></div>
      </div></div>
      {notesOpen && <NotesPane editor={editor} id={noteId} onSelect={setNoteId} onClose={() => setNotesOpen(false)} disabled={editDisabled}/>}
      {stylesOpen && !notesOpen && <StylesPane editor={editor} disabled={editDisabled} onClose={() => setStylesOpen(false)}
        onCreate={() => openDialog('Create paragraph style', { ...currentStyle(editor), id: `style-${crypto.randomUUID().slice(0, 16)}`, name: '', apply: true })}
        onEdit={style => openDialog('Modify paragraph style', { ...style })} onDelete={style => openDialog('Delete paragraph style', { ...style })}/>}
    </div>
    <footer className="de-status"><button onClick={() => setDialog('Word count')}>{stats.words.toLocaleString()} words</button><span>{readOnly ? 'Read only' : dirty ? 'Working draft' : 'New document'}</span><span className="de-status-notice" role="status">{busy ? 'Converting locally…' : notice || draftStatus || 'Approximate page view'}</span><label>Zoom<input aria-label="Document zoom" type="range" min="40" max="200" step="5" value={zoom} onChange={e => setZoom(Number(e.target.value))}/>{zoom}%</label></footer>

    {dialog === 'Insert table' && <Dialog title={dialog} onClose={() => setDialog(null)} action="Insert table" onSubmit={() => { editor.chain().focus().insertTable({ rows: Number(fields.rows), cols: Number(fields.columns), withHeaderRow: fields.header }).run(); setDialog(null); setTab('Table Layout'); }}><label>Rows<input autoFocus type="number" required min="1" max="100" value={fields.rows} onChange={e => setFields({ ...fields, rows: e.target.value })}/></label><label>Columns<input type="number" required min="1" max="12" value={fields.columns} onChange={e => setFields({ ...fields, columns: e.target.value })}/></label><label><input type="checkbox" checked={fields.header} onChange={e => setFields({ ...fields, header: e.target.checked })}/> Header row</label></Dialog>}
    {dialog === 'Column widths' && table && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={() => { setColumnWidths(editor, fields.widths.map(width => Math.round(Number(width) * 96))); setDialog(null); }}><TableWidthFields fields={fields} setFields={setFields} available={availableWidth}/></Dialog>}
    {dialog === 'Select table cells' && table && <Dialog title={dialog} action="Select cells" onClose={() => setDialog(null)} onSubmit={() => { selectCellRange(editor, { top: Number(fields.top) - 1, bottom: Number(fields.bottom), left: Number(fields.left) - 1, right: Number(fields.right) }); setDialog(null); }}><TableRangeFields fields={fields} setFields={setFields} context={table}/></Dialog>}
    {dialog === 'Hyperlink' && <Dialog title={dialog} onClose={() => setDialog(null)} action="Apply link" onSubmit={() => {
      try { setDocumentLink(editor, fields.href || '', fields.text || ''); setDialog(null); }
      catch (failure) { setFields({ ...fields, invalid: failure.message }); }
    }}><HyperlinkFields editor={editor} fields={fields} setFields={setFields}/></Dialog>}
    {dialog === 'Bookmarks' && <Dialog title={dialog} onClose={() => setDialog(null)}><BookmarkFields editor={editor} disabled={editDisabled}/></Dialog>}
    {dialog === 'Table of contents' && <Dialog title={dialog} action={references.toc ? 'Update contents settings' : 'Insert contents'} onClose={() => setDialog(null)} onSubmit={() => {
      try { saveContents(editor, { title: fields.title, maxLevel: Number(fields.maxLevel) }); setDialog(null); }
      catch (failure) { setFields({ ...fields, invalid: failure.message }); }
    }}><ContentsFields fields={fields} setFields={setFields}/></Dialog>}
    {dialog === 'Remove table of contents' && <Dialog title={dialog} action="Remove contents" onClose={() => setDialog(null)} onSubmit={() => { removeContents(editor); setDialog(null); }}><p>Remove the generated contents block? Your headings and text are kept. You can undo this change.</p></Dialog>}
    {dialog === 'Check internal links' && <Dialog title={dialog} onClose={() => setDialog(null)}><InternalLinkCheck editor={editor} onClose={() => setDialog(null)}/></Dialog>}
    {dialog === 'Note numbering' && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={() => {
      try { saveNoteSettings(editor, Object.fromEntries(['footnote', 'endnote'].map(kind => [kind, { format: fields[kind].format, start: Number(fields[kind].start) }]))); setDialog(null); }
      catch (failure) { setFields({ ...fields, invalid: failure.message }); }
    }}><NoteNumberFields fields={fields} setFields={setFields}/></Dialog>}
    {dialog === 'Convert notes' && <Dialog title={dialog} action="Convert all" onClose={() => setDialog(null)} onSubmit={() => { convertNotes(editor, fields.kind); setDialog(null); }}><label>Convert all notes to<select value={fields.kind} onChange={event => setFields({ kind: event.target.value })}><option value="endnote">Endnotes</option><option value="footnote">Footnotes</option></select></label><p>Keep each note's text and reference position. Numbers update in document order. Undo restores the previous kinds.</p></Dialog>}
    {dialog === 'Notes limit' && <Dialog title={dialog} onClose={() => setDialog(null)}><p>{fields.message}</p></Dialog>}
    {dialog === 'Manage sources' && <Dialog title={dialog} onClose={() => setDialog(null)}><SourceManager editor={editor} disabled={editDisabled}/></Dialog>}
    {['Insert citation', 'Edit citation'].includes(dialog) && <Dialog title={dialog} action={dialog === 'Insert citation' ? 'Insert citation' : 'Save citation'} onClose={() => setDialog(null)} onSubmit={editDisabled ? null : () => {
      try { saveCitation(editor, fields, fields.id || null); setDialog(null); } catch (failure) { setFields({ ...fields, invalid: failure.message }); }
    }}><CitationFields editor={editor} fields={fields} setFields={setFields} disabled={editDisabled}/>{dialog === 'Edit citation' && <button type="button" disabled={editDisabled} onClick={() => { removeCitation(editor, fields.id); setDialog(null); }}>Delete citation</button>}</Dialog>}
    {dialog === 'Bibliography' && <Dialog title={dialog} action="Apply bibliography" onClose={() => setDialog(null)} onSubmit={() => {
      try { saveBibliography(editor, fields); setDialog(null); } catch (failure) { setFields({ ...fields, invalid: failure.message }); }
    }}><BibliographyFields fields={fields} setFields={setFields}/></Dialog>}
    {dialog === 'Remove bibliography' && <Dialog title={dialog} action="Remove bibliography" onClose={() => setDialog(null)} onSubmit={() => { removeBibliography(editor); setDialog(null); }}><p>Remove the bibliography block? Your sources, citations and paragraph text stay in the document. Undo restores the block.</p></Dialog>}
    {dialog === 'Picture description' && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={() => { editor.chain().focus().updateAttributes('image', { alt: fields.alt }).run(); setDialog(null); }}><label>Alt text<textarea autoFocus maxLength={2000} value={fields.alt} onChange={e => setFields({ alt: e.target.value })}/></label></Dialog>}
    {dialog === 'Insert symbol' && <Dialog title={dialog} onClose={() => setDialog(null)} action="Insert" onSubmit={() => { editor.chain().focus().insertContent({ type: 'text', text: fields.symbol }).run(); setDialog(null); }}><label>Symbol<input autoFocus required maxLength={16} value={fields.symbol} onChange={e => setFields({ symbol: e.target.value })}/></label><div className="de-symbols">{'© ® ™ ° ± × ÷ ≤ ≥ ≠ ∞ α β γ Δ π Ω → ← ✓'.split(' ').map(symbol => <button type="button" key={symbol} onClick={() => setFields({ symbol })}>{symbol}</button>)}</div></Dialog>}
    {dialog === 'Open editable copy' && pendingImport && <Dialog title={dialog} action="Open editable copy" onClose={() => { setDialog(null); setPendingImport(null); }} onSubmit={() => replaceDocument(pendingImport, pendingImport.name)}><p><strong>{pendingImport.name}</strong></p>{pendingImport.warnings.map(warning => <p key={warning}>{warning}</p>)}{dirty && <p className="de-warning">Opening this copy replaces your current working draft. Export the current document first if you need to keep it.</p>}</Dialog>}
    {dialog === 'Word count' && <Dialog title={dialog} onClose={() => setDialog(null)}><dl className="de-counts">{Object.entries(stats).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl></Dialog>}
    {dialog === 'New document' && <Dialog title={dialog} action="Start new document" onClose={() => setDialog(null)} onSubmit={resetDocument}><p>Replace this working draft with a blank document? Export a DOCX first if you need to keep it.</p></Dialog>}
    {dialog === 'Discard recovery draft' && <Dialog title={dialog} action="Discard draft" onClose={() => setDialog(null)} onSubmit={() => task(async () => { await editorDraft('delete'); setRecovery(null); setDialog(null); setNotice('Recovery draft discarded'); })}><p>Remove the local recovery copy of “{recovery?.name}”? This cannot be undone. Exported DOCX files are unaffected.</p></Dialog>}
    {dialog === 'Header and footer' && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={() => { changeLayout({ ...fields, headerDistance: Number(fields.headerDistance), footerDistance: Number(fields.footerDistance) }); setDialog(null); }}><HeaderFooterFields fields={fields} setFields={setFields}/></Dialog>}
    {dialog === 'Page numbers' && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={() => { changeLayout({ ...fields, pageNumberStart: fields.pageNumbers ? Number(fields.pageNumberStart) : layout.pageNumberStart }); setDialog(null); }}><PageNumberFields fields={fields} setFields={setFields}/></Dialog>}
    {dialog === 'Line and page breaks' && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={() => { applyParagraph(fields); setDialog(null); }}><ParagraphPaginationFields fields={fields} setFields={setFields}/></Dialog>}
    {['Create paragraph style', 'Modify paragraph style'].includes(dialog) && <Dialog title={dialog} onClose={() => setDialog(null)} onSubmit={commitStyle} action="Save style"><ParagraphStyleFields fields={fields} setFields={setFields} creating={dialog === 'Create paragraph style'}/></Dialog>}
    {dialog === 'Delete paragraph style' && <Dialog title={dialog} onClose={() => setDialog(null)} action="Delete style" onSubmit={() => { removeParagraphStyle(editor, fields.id); setDialog(null); setNotice('Style removed. Undo can restore it.'); }}><p>Delete “{fields.name}” from this document? Its paragraphs will use {fields.level ? `Heading ${fields.level}` : 'Normal'}. Direct formatting is retained. You can undo this change.</p></Dialog>}
  </section>;
}

export default function DocumentEditor({ active = true }) {
  const [opened, setOpened] = useState(active);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  return opened ? <RichDocumentEditor active={active}/> : null;
}
