import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { documentExtensions, documentStats, documentMatches, resetDocumentContent } from '../../src/documentEditor';
import { emptySource, sourceError, sourceCatalog, citationsIn, citationContext, citationLabel, bibliographyEntries,
  saveSource, removeSource, importSources, saveCitation, removeCitation, setCitationStyle, saveBibliography, removeBibliography, goToCitation, citationPlugin, DocumentBibliography, DocumentCitation } from '../../src/documentCitations';

const schema = getSchema(documentExtensions());
const book = (title = 'Analytical notes') => ({ ...emptySource(), title, year: '1843', authors: [{ family: 'Lovelace', given: 'Ada' }], publisher: 'Example Press' });
const attrs = (...ids) => ({ sourceIds: ids, mode: 'parenthetical', locator: '', prefix: '', suffix: '' });
function editorFor() {
  const editor = { schema, isEditable: true, state: EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }] }), plugins: [history(), citationPlugin()] }), commands: { focus() {} } };
  editor.view = { dispatch(tr) { editor.state = editor.state.applyTransaction(tr).state; }, updateState(next) { editor.state = next; } }; return editor;
}
const label = editor => citationLabel(citationsIn(editor.state.doc).citations[0], citationContext(editor.state.doc));
const entries = editor => bibliographyEntries(editor.state.doc).map(entry => entry.parts.map(part => part.text).join(''));

describe('local citations and bibliography', () => {
  it('keeps selected text, inserts an editable citation, and excludes generated material from body search/counts', () => {
    const e = editorFor(), source = book(); saveSource(e, source);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1, 5)));
    saveCitation(e, { ...attrs(source.id), locator: 'p. 12', prefix: 'See', suffix: 'for details' });
    saveBibliography(e, { title: 'References', includeUncited: false });
    expect(e.state.doc.textContent).toBe('Body text'); expect(documentStats(e.state.doc).words).toBe(2);
    expect(documentMatches(e.state.doc, 'Lovelace', false)).toHaveLength(0);
    expect(label(e)).toBe('See (Lovelace, 1843, p. 12) for details');
    expect(entries(e)).toEqual(['Lovelace, A. (1843). Analytical notes. Example Press.']);
    expect(bibliographyEntries(e.state.doc)[0].parts.find(part => part.text === source.title).italic).toBe(true);
  });
  it('updates every citation and bibliography when a source changes, with atomic Undo/Redo', () => {
    const e = editorFor(), source = book(); saveSource(e, source); const id = saveCitation(e, attrs(source.id));
    saveBibliography(e, { title: 'References', includeUncited: false });
    saveSource(e, { ...source, year: '1844', title: 'Revised notes' });
    expect(label(e)).toBe('(Lovelace, 1844)'); expect(entries(e)[0]).toContain('Revised notes');
    undo(e.state, e.view.dispatch); expect(label(e)).toBe('(Lovelace, 1843)');
    redo(e.state, e.view.dispatch); expect(entries(e)[0]).toContain('Revised notes');
    saveCitation(e, { ...attrs(source.id), mode: 'narrative', locator: 'chapter 2' }, id);
    expect(label(e)).toBe('Lovelace (1844, chapter 2)'); removeCitation(e, id);
    expect(e.state.doc.textContent).toBe('Body text'); expect(entries(e)).toEqual([]);
    undo(e.state, e.view.dispatch); expect(label(e)).toBe('Lovelace (1844, chapter 2)');
  });
  it('renumbers citations in appearance order and disambiguates same-author/year titles', () => {
    const e = editorFor(), a = book('Alpha'), z = book('Zeta'); saveSource(e, z); saveSource(e, a);
    saveCitation(e, attrs(z.id)); saveCitation(e, attrs(a.id));
    expect(citationsIn(e.state.doc).citations.map(item => citationLabel(item, citationContext(e.state.doc)))).toEqual(['(Lovelace, 1843b)', '(Lovelace, 1843a)']);
    saveBibliography(e, { title: 'References', includeUncited: false }); setCitationStyle(e, 'numeric');
    expect(bibliographyEntries(e.state.doc).map(entry => entry.source.title)).toEqual(['Zeta', 'Alpha']); expect(label(e)).toBe('[1]');
    removeCitation(e, citationsIn(e.state.doc).citations[0].id); expect(label(e)).toBe('[1]'); expect(entries(e)).toHaveLength(1);
    undo(e.state, e.view.dispatch); expect(entries(e)).toHaveLength(2);
  });
  it('formats journal articles, organizations, DOI links, anonymous sources and multiple citations', () => {
    const e = editorFor(), a = { ...book('A study'), type: 'article', journal: 'Example Journal', volume: '2', issue: '1', pages: '10–20', doi: '10.1234/example', url: 'https://example.org/ignored' };
    const web = { ...book('Project guide'), type: 'website', authors: [{ literal: 'Example Lab' }], year: '', siteName: 'Example Lab', url: 'https://example.org/guide' };
    saveSource(e, a); saveSource(e, web); saveCitation(e, attrs(a.id, web.id));
    expect(label(e)).toBe('(Lovelace, 1843; Example Lab, n.d.)');
    expect(entries(e)).toEqual(['Example Lab. (n.d.). Project guide. https://example.org/guide', 'Lovelace, A. (1843). A study. Example Journal, 2(1), 10–20. https://doi.org/10.1234/example']);
    expect(bibliographyEntries(e.state.doc)[1].parts.at(-1).href).toBe('https://doi.org/10.1234/example');
  });
  it('includes uncited sources only when requested, and supports bibliography removal and Undo', () => {
    const e = editorFor(); saveSource(e, book()); saveBibliography(e, { title: 'Reading list', includeUncited: true });
    expect(bibliographyEntries(e.state.doc, true)).toHaveLength(1); expect(entries(e)).toHaveLength(0);
    removeBibliography(e); expect(citationsIn(e.state.doc).bibliography).toBeNull();
    undo(e.state, e.view.dispatch); expect(citationsIn(e.state.doc).bibliography.title).toBe('Reading list');
  });
  it('merges identical source lists, remaps collisions without retargeting existing citations, and rejects invalid lists atomically', () => {
    const e = editorFor(), source = book(); saveSource(e, source); saveCitation(e, attrs(source.id));
    importSources(e, { version: 1, sources: [source] }); expect(sourceCatalog(e.state.doc)).toHaveLength(1);
    importSources(e, { version: 1, sources: [{ ...source, title: 'Other work' }] });
    expect(sourceCatalog(e.state.doc)).toHaveLength(2); expect(new Set(sourceCatalog(e.state.doc).map(item => item.id)).size).toBe(2);
    expect(label(e)).toBe('(Lovelace, 1843)'); undo(e.state, e.view.dispatch); expect(sourceCatalog(e.state.doc)).toHaveLength(1);
    expect(() => importSources(e, { version: 1, sources: [book(), { ...book(), url: 'file:///private' }] })).toThrow();
    expect(sourceCatalog(e.state.doc)).toHaveLength(1); expect(() => removeSource(e, source.id)).toThrow(/cited/);
  });
  it('gives pasted citations independent IDs and clears history across file/recovery resets', () => {
    const e = editorFor(), source = book(); saveSource(e, source); saveCitation(e, attrs(source.id));
    e.view.dispatch(e.state.tr.insert(2, citationsIn(e.state.doc).citations[0].node));
    expect(new Set(citationsIn(e.state.doc).citations.map(item => item.id)).size).toBe(2);
    const recovered = e.state.doc.toJSON(); resetDocumentContent(e, recovered);
    expect(sourceCatalog(e.state.doc)[0].title).toBe(source.title); expect(undo(e.state, e.view.dispatch)).toBe(false);
  });
  it('guards all mutations in read-only mode while allowing navigation', () => {
    const e = editorFor(), source = book(); saveSource(e, source); const id = saveCitation(e, attrs(source.id)); e.isEditable = false;
    const before = e.state.doc.toJSON();
    expect(saveSource(e, source)).toBe(false); expect(removeSource(e, source.id)).toBe(false); expect(importSources(e, {})).toBe(false);
    expect(saveCitation(e, attrs(source.id), id)).toBe(false); expect(removeCitation(e, id)).toBe(false);
    expect(setCitationStyle(e, 'numeric')).toBe(false); expect(saveBibliography(e, {})).toBe(false); expect(removeBibliography(e)).toBe(false);
    expect(goToCitation(e, id)).toBe(true); expect(e.state.doc.toJSON()).toEqual(before);
  });
  it('enforces bibliography placement and cardinality at transaction level', () => {
    const e = editorFor(), bib = schema.nodes.documentBibliography.create();
    e.view.dispatch(e.state.tr.insert(0, schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, [schema.nodes.paragraph.create(), bib])))); expect(citationsIn(e.state.doc).bibliography).toBeNull();
    e.view.dispatch(e.state.tr.insert(0, [bib, bib])); expect(citationsIn(e.state.doc).bibliography).toBeNull();
  });
  it('rejects excessive citation/source transactions and serializes full generated visible HTML', () => {
    const e = editorFor(), source = book(); saveSource(e, source); saveCitation(e, attrs(source.id)); saveBibliography(e, { title: 'References', includeUncited: false });
    const { citations, bibliography } = citationsIn(e.state.doc);
    const html = DocumentBibliography.config.renderHTML.call({ editor: e }, { node: bibliography.node });
    expect(JSON.stringify(html)).toContain('Analytical notes'); expect(JSON.stringify(html)).toContain('1843');
    expect(DocumentCitation.config.renderHTML.call({ editor: e }, { node: citations[0].node }).at(-1)).toBe('(Lovelace, 1843)');
    e.view.dispatch(e.state.tr.insert(2, Array(1000).fill(citations[0].node))); expect(citationsIn(e.state.doc).citations).toHaveLength(1);
    expect(() => importSources(e, { version: 1, sources: Array.from({ length: 100 }, () => book()) })).toThrow(/100 sources/);
    expect(sourceCatalog(e.state.doc)).toHaveLength(1);
  });
  it.each([{ year: '202' }, { authors: [{ given: 'Ada' }] }, { url: 'javascript:alert(1)' }, { doi: 'bad' }, { title: '😀'.repeat(251) }, { title: '\ud800' }])('rejects unsupported source values: %j', changes => {
    expect(sourceError({ ...book(), ...changes })).toBeTruthy();
  });
});
