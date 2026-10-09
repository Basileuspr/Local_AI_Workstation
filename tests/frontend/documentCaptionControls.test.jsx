import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { documentExtensions } from '../../src/documentEditor';
import { CaptionFields, CaptionNumberFields, CrossReferenceFields, CrossReferenceCheck, CaptionsRibbon } from '../../src/components/DocumentCaptionControls';
import { DocumentCaption, DocumentCrossReference, saveCaption, saveCrossReference, saveCaptionNumbering, captionsIn } from '../../src/documentCaptions';

function editorFor() {
  const schema = getSchema(documentExtensions()), listeners = new Set();
  const e = { schema, isEditable:true, commands:{ focus() {} }, state:EditorState.create({ schema, doc:schema.nodeFromJSON({ type:'doc',content:[{ type:'paragraph',content:[{ type:'text',text:'Body' }] }] }) }), on(_event,fn) { listeners.add(fn); }, off(_event,fn) { listeners.delete(fn); } };
  e.view = { dispatch(tr) { e.state=e.state.apply(tr); for (const fn of listeners) fn(); } }; return e;
}
describe('caption controls and simulated node-view interactions', () => {
  it('renders supported options, current values, missing-target repair and read-only fields', () => {
    const e=editorFor(), id=saveCaption(e,{ label:'Figure',text:'A plot' });
    const fields={ target:id,display:'number',hyperlink:true };
    const html=renderToStaticMarkup(<CrossReferenceFields editor={e} fields={fields} setFields={()=>{}} disabled/>);
    expect(html).toContain('<fieldset disabled'); expect(html).toContain('Label and number'); expect(html).toContain('Number only'); expect(html).toContain('Preview: 1');
    const caption=renderToStaticMarkup(<CaptionFields editor={e} fields={{ label:'Exhibit',text:'Custom caption',position:'before' }} setFields={()=>{}} inserting/>);
    expect(caption).toContain('Custom label'); expect(caption).toContain('Above current picture'); expect(caption).toContain('Custom caption');
    const numbering=renderToStaticMarkup(<CaptionNumberFields editor={e} fields={{ label:'Figure',format:'upperRoman',start:4 }} setFields={()=>{}}/>);
    expect(numbering).toContain('I, II, III'); expect(numbering).toContain('value="4"');
    const attrs={ id:'xref-'+'a'.repeat(32),target:'Missing',display:'full',hyperlink:true };
    e.view.dispatch(e.state.tr.insert(1,e.schema.nodes.documentCrossReference.create(attrs)));
    const check=renderToStaticMarkup(<CrossReferenceCheck editor={e} disabled={false} openDialog={()=>{}}/>);
    expect(check).toContain('1 missing destinations'); expect(check).toContain('Missing reference: Missing'); expect(check).toContain('Edit / retarget');
    const Group=({children})=><div>{children}</div>, Button=({label,disabled,onClick,children})=><button disabled={disabled} aria-label={label} onClick={onClick}>{children}</button>;
    const ribbon=renderToStaticMarkup(<CaptionsRibbon editor={e} disabled openDialog={()=>{}} Group={Group} Button={Button}/>);
    expect(ribbon).toContain('disabled="" aria-label="Insert caption"'); expect(ribbon).toContain('Check references (1)');
  });
  it('routes caption/reference clicks, updates displayed numbers, and follows read-only hyperlinks without mutation', () => {
    const { document,window }=parseHTML('<html><body><main></main></body></html>');
    vi.stubGlobal('document',document); vi.stubGlobal('CustomEvent',window.CustomEvent);
    try {
      const e=editorFor(), id=saveCaption(e,{ label:'Figure',text:'A plot' }); e.view.dom=document.querySelector('main');
      e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc,1))); const ref=saveCrossReference(e,{ target:id,display:'labelNumber',hyperlink:true });
      const { captions,references }=captionsIn(e.state.doc); const events=[]; e.view.dom.addEventListener('document-caption-open',event=>events.push(event.detail));
      const captionView=DocumentCaption.config.addNodeView()({ editor:e,node:captions[0].node }); const refView=DocumentCrossReference.config.addNodeView()({ editor:e,node:references[0].node }); e.view.dom.append(captionView.dom,refView.dom);
      captionView.dom.querySelector('button').click(); refView.dom.querySelector('button').click(); expect(events).toEqual([{kind:'caption',id},{kind:'reference',id:ref}]);
      saveCaptionNumbering(e,'Figure',{ format:'upperRoman',start:4 }); expect(captionView.dom.textContent).toBe('Figure IV: A plot'); expect(refView.dom.textContent).toBe('Figure IV');
      e.isEditable=false; let scrolled=false; e.view.nodeDOM=()=>({scrollIntoView(){scrolled=true;}}); const before=e.state.doc.toJSON(); refView.dom.querySelector('button').click(); expect(scrolled).toBe(true); expect(e.state.doc.toJSON()).toEqual(before); expect(events).toHaveLength(2);
      captionView.destroy(); refView.destroy();
    } finally { vi.unstubAllGlobals(); }
  });
});
