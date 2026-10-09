import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { documentExtensions, resetDocumentContent, documentStats, documentMatches } from '../../src/documentEditor';
import { documentReferences, referencePlugin, saveBookmark, bookmarkError, goToReference } from '../../src/documentReferences';
import { captionsIn, captionContext, captionNumber, captionPlugin, saveCaption, removeCaption, saveCaptionNumbering,
  saveCrossReference, removeCrossReference, moveCaption, crossReferenceText, DocumentCaption, DocumentCrossReference } from '../../src/documentCaptions';

const schema = getSchema(documentExtensions());
const paragraph = text => ({ type:'paragraph', content:[{ type:'text', text }] });
function editorFor(content = [paragraph('Body text')]) {
  const e = { schema, isEditable:true, commands:{ focus() {} }, state:EditorState.create({ schema, doc:schema.nodeFromJSON({ type:'doc', content }), plugins:[history(),referencePlugin(),captionPlugin()] }) };
  e.view = { dispatch(tr) { e.state = e.state.applyTransaction(tr).state; }, updateState(next) { e.state = next; } }; return e;
}
const select = (e, from, to = from) => e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc,from,to)));
const text = e => crossReferenceText(captionsIn(e.state.doc).references[0],e.state.doc);

describe('captions and live cross-references', () => {
  it('keeps paragraph text, inserts above/below current root block and numbers by label in document order', () => {
    const e = editorFor(); const a = saveCaption(e,{ label:'Figure',text:'First' });
    select(e,1); saveCaption(e,{ label:'Table',text:'Table data' },null,'before');
    select(e,captionContext(e.state.doc).captions[0].node.nodeSize + 1); saveCaption(e,{ label:'Figure',text:'Earlier' },null,'before');
    expect(captionContext(e.state.doc).captions.map(item => item.full)).toEqual(['Table 1: Table data','Figure 1: Earlier','Figure 2: First']);
    expect(e.state.doc.textContent).toBe('Body text'); expect(documentStats(e.state.doc).words).toBe(2); expect(documentMatches(e.state.doc,'First')).toHaveLength(0);
    expect(documentReferences(e.state.doc).targets.has(a)).toBe(true); expect(bookmarkError(a,e.state.doc)).toContain('reserved');
  });
  it('positions a caption outside tables and next to a selected picture', () => {
    const table = { type:'table', content:[{ type:'tableRow', content:[{ type:'tableCell', content:[paragraph('Cell')] }] }] };
    const e = editorFor([table, { type:'image', attrs:{ src:'data:image/png;base64,x' } }]); select(e,4); saveCaption(e,{ label:'Table',text:'Grid' });
    expect(e.state.doc.content.content.map(node => node.type.name)).toEqual(['table','documentCaption','image']);
    const imagePos = e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize;
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc,imagePos))); saveCaption(e,{ label:'Figure',text:'Image' },null,'before');
    expect(e.state.doc.content.content.map(node => node.type.name)).toEqual(['table','documentCaption','documentCaption','image']);
  });
  it('updates all displays after edits/numbering/deletion and restores complete state with Undo/Redo', () => {
    const e = editorFor(), id = saveCaption(e,{ label:'Figure',text:'Original' }); select(e,1);
    const refId = saveCrossReference(e,{ target:id,display:'full',hyperlink:true }); expect(text(e)).toBe('Figure 1: Original');
    saveCaption(e,{ label:'Figure',text:'Revised' },id); expect(text(e)).toBe('Figure 1: Revised');
    saveCaptionNumbering(e,'Figure',{ format:'upperRoman',start:4 }); expect(text(e)).toBe('Figure IV: Revised');
    saveCrossReference(e,{ target:id,display:'number',hyperlink:false },refId); expect(text(e)).toBe('IV');
    removeCaption(e,id); expect(text(e)).toContain('Missing reference'); undo(e.state,e.view.dispatch); expect(text(e)).toBe('IV');
    undo(e.state,e.view.dispatch); expect(text(e)).toBe('Figure IV: Revised'); redo(e.state,e.view.dispatch); expect(text(e)).toBe('IV');
    removeCrossReference(e,refId); expect(e.state.doc.textContent).toBe('Body text'); undo(e.state,e.view.dispatch); expect(text(e)).toBe('IV');
  });
  it('keeps selected text and updates heading text and bookmark renames atomically', () => {
    const headingId = 'LAW_H' + 'a'.repeat(32), e = editorFor([{ type:'heading',attrs:{ level:1,referenceId:headingId },content:[{ type:'text',text:'Overview' }] },paragraph('Body text')]);
    select(e,11,15); saveCrossReference(e,{ target:headingId,display:'full',hyperlink:true }); expect(e.state.doc.textContent).toBe('OverviewBody text');
    e.view.dispatch(e.state.tr.insertText('New ',1)); expect(text(e)).toBe('New Overview');
    select(e,e.state.doc.child(0).nodeSize + 1); saveBookmark(e,'Target'); saveCrossReference(e,{ target:'Target',display:'full',hyperlink:false });
    saveBookmark(e,'Renamed','Target'); expect(captionsIn(e.state.doc).references.some(item => item.target === 'Renamed')).toBe(true);
    expect(captionsIn(e.state.doc).references.some(item => item.target === 'Target')).toBe(false);
  });
  it('gives pasted captions independent IDs without stealing existing references and clears import history', () => {
    const e = editorFor(), id = saveCaption(e,{ label:'Figure',text:'Original' }); select(e,1); saveCrossReference(e,{ target:id,display:'full',hyperlink:true });
    const original = captionContext(e.state.doc).map.get(id); e.view.dispatch(e.state.tr.insert(0,original.node));
    const list = captionContext(e.state.doc).captions; expect(new Set(list.map(item => item.id)).size).toBe(2); expect(list[1].id).toBe(id); expect(text(e)).toBe('Figure 2: Original');
    resetDocumentContent(e,e.state.doc.toJSON()); expect(captionsIn(e.state.doc).references[0].target).toBe(id); expect(undo(e.state,e.view.dispatch)).toBe(false);
  });
  it('uses custom labels and extended Roman/letter numbering', () => {
    const e = editorFor(); saveCaption(e,{ label:'Exhibit',text:'A' }); saveCaptionNumbering(e,'Exhibit',{ format:'lowerLetter',start:27 });
    expect(captionContext(e.state.doc).captions[0].full).toBe('Exhibit aa: A');
    expect(captionNumber(49,'upperRoman')).toBe('XLIX'); expect(captionNumber(702,'lowerLetter')).toBe('zz');
    saveCaption(e,{ label:'exhibit',text:'B' }); expect(captionContext(e.state.doc).captions[1].labelNumber).toBe('Exhibit ab');
  });
  it('reorders captions across whole blocks without changing targets, and restores numbering with Undo', () => {
    const e=editorFor(), first=saveCaption(e,{ label:'Figure',text:'First' });
    const second=saveCaption(e,{ label:'Figure',text:'Second' }); select(e,1); saveCrossReference(e,{ target:second,display:'full',hyperlink:true });
    expect(text(e)).toBe('Figure 2: Second'); expect(moveCaption(e,second,-1)).toBe(true); expect(text(e)).toBe('Figure 1: Second');
    expect(captionsIn(e.state.doc).references[0].target).toBe(second); expect(captionContext(e.state.doc).map.get(first).labelNumber).toBe('Figure 2');
    undo(e.state,e.view.dispatch); expect(text(e)).toBe('Figure 2: Second'); e.isEditable=false; expect(moveCaption(e,second,-1)).toBe(false);
  });
  it('blocks mutations in read-only while navigation scrolls the actual caption DOM', () => {
    const e = editorFor(), id = saveCaption(e,{ label:'Figure',text:'A' }); select(e,1); const ref = saveCrossReference(e,{ target:id,display:'full',hyperlink:true }); e.isEditable = false;
    const before = e.state.doc.toJSON(); let scrolled = false; e.view.nodeDOM = () => ({ scrollIntoView() { scrolled = true; } });
    expect(saveCaption(e,{})).toBe(false); expect(removeCaption(e,id)).toBe(false); expect(saveCaptionNumbering(e,'Figure',{})).toBe(false);
    expect(saveCrossReference(e,{})).toBe(false); expect(removeCrossReference(e,ref)).toBe(false); expect(goToReference(e,id)).toBe(true); expect(scrolled).toBe(true); expect(e.state.doc.toJSON()).toEqual(before);
  });
  it('enforces limits and root placement, and serializes visible HTML rather than live clipboard nodes', () => {
    const e = editorFor(), id = saveCaption(e,{ label:'Figure',text:'A' }); select(e,1); saveCrossReference(e,{ target:id,display:'labelNumber',hyperlink:true });
    const { captions,references } = captionsIn(e.state.doc); e.view.dispatch(e.state.tr.insert(0,Array(200).fill(captions[0].node))); expect(captionsIn(e.state.doc).captions).toHaveLength(1);
    e.view.dispatch(e.state.tr.insert(1,Array(1000).fill(references[0].node))); expect(captionsIn(e.state.doc).references).toHaveLength(1);
    const list = schema.nodes.bulletList.create(null,schema.nodes.listItem.create(null,[schema.nodes.paragraph.create(),captions[0].node])); e.view.dispatch(e.state.tr.insert(0,list)); expect(captionsIn(e.state.doc).captions).toHaveLength(1);
    expect(DocumentCaption.config.renderHTML.call({ editor:e },{ node:captions[0].node }).at(-1)).toBe('Figure 1: A');
    expect(DocumentCrossReference.config.renderHTML.call({ editor:e },{ node:references[0].node }).at(-1)).toBe('Figure 1');
    expect(() => saveCaption(e,{ label:'Bad"label',text:'A' })).toThrow(); expect(() => saveCaption(e,{ label:'Figure',text:'😀'.repeat(501) })).toThrow();
    expect(() => saveCaptionNumbering(e,'Figure',{ format:'decimal',start:0 })).toThrow(); expect(() => saveCrossReference(e,{ target:'Missing',display:'full',hyperlink:true })).toThrow();
  });
});
