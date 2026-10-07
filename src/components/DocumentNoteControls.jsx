import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { generateHTML } from '@tiptap/core';
import { documentNotes, noteSettings, NOTE_FORMATS, EMPTY_NOTE, noteEditorExtensions, insertNote, updateNote, deleteNote, convertNotes, goToNote } from '../documentNotes';
import { DOCUMENT_FONTS, cleanDocumentPaste } from '../documentEditor';

export function NotesRibbon({ editor, disabled, openDialog, onOpen, Group, Button }) {
  const notes = documentNotes(editor.state.doc);
  const add = kind => { try { const id = insertNote(editor, kind); if (id) onOpen(id); } catch (failure) { openDialog('Notes limit', { message: failure.message }); } };
  const step = direction => {
    const position = editor.state.selection.from;
    const next = direction > 0 ? notes.find(note => note.pos > position) || notes[0] : [...notes].reverse().find(note => note.pos < position) || notes.at(-1);
    if (next) { goToNote(editor, next.id); onOpen(next.id); }
  };
  return <Group name="Footnotes & Endnotes">
    <Button label="Insert footnote (Ctrl+Alt+F)" disabled={disabled || notes.length >= 200} onClick={() => add('footnote')}>Insert footnote</Button>
    <Button label="Insert endnote (Ctrl+Alt+D)" disabled={disabled || notes.length >= 200} onClick={() => add('endnote')}>Insert endnote</Button>
    <Button label="Previous note" disabled={!notes.length} onClick={() => step(-1)}>Previous</Button><Button label="Next note" disabled={!notes.length} onClick={() => step(1)}>Next note</Button>
    <Button label="Show notes pane" onClick={() => onOpen(notes[0]?.id || '')}>Show notes</Button>
    <Button label="Footnote and endnote numbering" disabled={disabled} onClick={() => openDialog('Note numbering', noteSettings(editor.state.doc))}>Numbering…</Button>
    <Button label="Convert footnotes and endnotes" disabled={disabled || !notes.length} onClick={() => openDialog('Convert notes', { kind: 'endnote' })}>Convert…</Button>
  </Group>;
}

export function NoteNumberFields({ fields, setFields }) {
  return <>{['footnote', 'endnote'].map(kind => <fieldset className="de-note-numbering" key={kind}><legend>{kind === 'footnote' ? 'Footnotes' : 'Endnotes'}</legend>
    <label>Number format<select aria-label={`${kind} number format`} value={fields[kind].format} onChange={event => setFields({ ...fields, [kind]: { ...fields[kind], format: event.target.value }, invalid: '' })}>{NOTE_FORMATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>Start at<input aria-label={`${kind} starting number`} type="number" min={1} max={9999} required value={fields[kind].start} onChange={event => setFields({ ...fields, [kind]: { ...fields[kind], start: event.target.value }, invalid: '' })}/></label>
    </fieldset>)}<p>Each kind numbers continuously through the document. DOCX footnotes use the bottom of the page; endnotes use the end of the document. Page/section restarts and custom symbols are deferred.</p>
    {fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}

function NoteBodyEditor({ parent, item, disabled }) {
  const latest = useRef({ item, disabled }); latest.current = { item, disabled };
  const [error, setError] = useState('');
  const [extensions] = useState(() => noteEditorExtensions(parent));
  const noteEditor = useEditor({ extensions, immediatelyRender: false, shouldRerenderOnTransaction: true, content: item.body || EMPTY_NOTE,
    editorProps: { attributes: { class: 'de-note-body', role: 'textbox', 'aria-label': 'Note text', 'aria-multiline': 'true', spellcheck: 'true' }, transformPastedHTML: cleanDocumentPaste,
      handleDrop: (_view, event) => !!event.dataTransfer?.files?.length, handlePaste: (_view, event) => !!event.clipboardData?.files?.length },
    onUpdate: ({ editor }) => { try { updateNote(parent, latest.current.item.id, editor.getJSON()); setError(''); } catch (failure) { setError(failure.message); } },
  });
  useEffect(() => {
    if (!noteEditor) return;
    noteEditor.setEditable(!disabled, false);
    if (JSON.stringify(noteEditor.getJSON()) !== JSON.stringify(item.body)) noteEditor.commands.setContent(item.body, { emitUpdate: false });
  }, [noteEditor, item.body, disabled]);
  useEffect(() => { if (noteEditor && !disabled) noteEditor.commands.focus('end'); }, [noteEditor, item.id]);
  if (!noteEditor) return null;
  const size = noteEditor.getAttributes('textStyle').fontSize || '10pt';
  const sizes = [...new Set(['8pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', size])];
  const mark = (type, text) => <button type="button" aria-label={`Note ${type}`} aria-pressed={noteEditor.isActive(type)} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => noteEditor.chain().focus().toggleMark(type).run()}>{text}</button>;
  return <><div className="de-note-toolbar" aria-label="Note formatting">
    {mark('bold', <b>B</b>)}{mark('italic', <i>I</i>)}{mark('underline', <u>U</u>)}{mark('strike', <s>S</s>)}{mark('subscript', 'x₂')}{mark('superscript', 'x²')}
    <button type="button" aria-label="Note highlight" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => noteEditor.chain().focus().toggleHighlight({ color: '#FFFF00' }).run()}>Highlight</button>
    <button type="button" aria-label="Clear note formatting" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => noteEditor.chain().focus().unsetAllMarks().run()}>Clear</button>
    <select aria-label="Note font" disabled={disabled} value={noteEditor.getAttributes('textStyle').fontFamily || 'Calibri'} onChange={event => noteEditor.chain().focus().setFontFamily(event.target.value).run()}>{DOCUMENT_FONTS.map(font => <option key={font}>{font}</option>)}</select>
    <select aria-label="Note font size" disabled={disabled} value={size} onChange={event => noteEditor.chain().focus().setFontSize(event.target.value).run()}>{sizes.map(size => <option key={size}>{size}</option>)}</select>
    <label className="de-note-color">Color<input type="color" aria-label="Note text color" disabled={disabled} value={noteEditor.getAttributes('textStyle').color || '#17202a'} onChange={event => noteEditor.chain().focus().setColor(event.target.value).run()}/></label>
    {['left', 'center', 'right', 'justify'].map(align => <button key={align} type="button" aria-label={`Note align ${align}`} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => noteEditor.chain().focus().setTextAlign(align).run()}>{align}</button>)}
  </div><EditorContent editor={noteEditor}/>{error && <p role="alert">{error}</p>}<p className="de-shortcut">Up to 40 paragraphs and 10,000 characters · Ctrl+Z undoes note edits</p>
    <div className="de-note-link"><label>Web/email link<input aria-label="Note link address" maxLength={2048} disabled={disabled} placeholder="https://…" onKeyDown={event => {
      if (event.key !== 'Enter') return; event.preventDefault();
      const href = event.currentTarget.value.trim(); if (!/^(https?:\/\/|mailto:)[^\s\x00-\x1f<>]+$/i.test(href)) { setError('Use an http, https or mailto address.'); return; }
      if (noteEditor.state.selection.empty && !noteEditor.isActive('link')) noteEditor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).unsetMark('link').run();
      else noteEditor.chain().focus().extendMarkRange('link').setLink({ href }).run(); event.currentTarget.value = ''; setError('');
    }}/></label><small>Select note text, enter a URL, then press Enter.</small><button type="button" disabled={disabled || !noteEditor.isActive('link')} onMouseDown={event => event.preventDefault()} onClick={() => noteEditor.chain().focus().extendMarkRange('link').unsetLink().run()}>Unlink</button></div></>;
}

export function NotesPane({ editor, id, onSelect, onClose, disabled }) {
  const notes = documentNotes(editor.state.doc), item = notes.find(note => note.id === id) || notes[0], index = notes.indexOf(item);
  return <aside className="de-notes-pane" aria-label="Footnotes and endnotes"><header><h2>Notes</h2><button type="button" aria-label="Close notes pane" onClick={onClose}>×</button></header>
    {!item ? <p>Place the cursor in the document and use References → Insert footnote or Insert endnote.</p> : <>
      <label>Selected note<select aria-label="Selected note" value={item.id} onChange={event => onSelect(event.target.value)}>{notes.map(note => <option key={note.id} value={note.id}>{note.title} {note.label}</option>)}</select></label>
      <div className="de-note-actions"><button type="button" disabled={index <= 0} onClick={() => onSelect(notes[index - 1].id)}>Previous</button><button type="button" disabled={index >= notes.length - 1} onClick={() => onSelect(notes[index + 1].id)}>Next</button><button type="button" onClick={() => goToNote(editor, item.id, false)}>Go to reference</button></div>
      <label>Note type<select aria-label="Note type" disabled={disabled} value={item.kind} onChange={event => convertNotes(editor, event.target.value, item.id)}><option value="footnote">Footnote</option><option value="endnote">Endnote</option></select></label>
      <h3>{item.title} {item.label}</h3><NoteBodyEditor key={item.id} parent={editor} item={item} disabled={disabled}/>
      <button type="button" className="de-note-delete" disabled={disabled} onClick={() => deleteNote(editor, item.id)}>Delete note and reference</button><p className="de-shortcut">Undo restores a deleted note. Your paragraph text is kept.</p>
    </>}</aside>;
}

function NotePreview({ item, onOpen }) {
  const html = useMemo(() => generateHTML(item.body, noteEditorExtensions()), [item.body]);
  return <div className="de-note-preview"><button type="button" aria-label={`Open ${item.kind} ${item.label}`} onClick={() => onOpen(item.id)}>{item.label}</button><div className="de-note-body" dangerouslySetInnerHTML={{ __html: html }}/></div>;
}

export function DocumentNotesPreview({ editor, onOpen }) {
  const notes = documentNotes(editor.state.doc);
  return notes.length ? <div className="de-notes-preview">{['footnote', 'endnote'].map(kind => {
    const items = notes.filter(note => note.kind === kind); if (!items.length) return null;
    return <section key={kind} aria-label={`${kind === 'footnote' ? 'Footnotes' : 'Endnotes'} preview`}><h2>{kind === 'footnote' ? 'Footnotes — continuous view' : 'Endnotes'}</h2>{kind === 'footnote' && <small>DOCX readers place these at the bottom of their pages.</small>}
      {items.map(item => <NotePreview key={item.id} item={item} onOpen={onOpen}/>)}</section>;
  })}</div> : null;
}
