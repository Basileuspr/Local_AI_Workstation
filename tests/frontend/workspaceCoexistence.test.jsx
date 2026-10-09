import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ChatWorkspaceProvider,useChatWorkspace,WorkspacePinControls} from '../../src/ChatWorkspace';
import {CHAT_PINS_KEY,WORKSPACE_PINS_KEY,workspaceVisible} from '../../src/chatPins';

let state,workspace,root,values;
vi.mock('../../src/useStore',()=>({useStore:()=>state,useDispatch:()=>vi.fn()}));
function Harness() {
  workspace=useChatWorkspace();
  return <><WorkspacePinControls activeTab={state.activeSidebarTab}/>{['generate','browser','chats'].map(tab=>
    <section key={tab} data-tab={tab} hidden={!workspaceVisible(state.activeSidebarTab,workspace.pin,tab,workspace.workspacePin)}>
      <textarea defaultValue={`${tab} draft`}/>
    </section>)}</>;
}
async function render() {await act(async()=>root.render(<ChatWorkspaceProvider><Harness/></ChatWorkspaceProvider>));}
beforeEach(()=>{
  const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  values=new Map();vi.stubGlobal('localStorage',{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)});
  state={currentSessionId:'saved-chat',activeSidebarTab:'generate',conversationHistory:[]};
  root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('retains independent tool pairs, chat attachments and the same editable DOM across pin changes and navigation',async()=>{
  await render();
  const draft=document.querySelector('[data-tab="generate"] textarea');draft.value='Unsaved prompt';
  await act(async()=>{workspace.setPin({kind:'document',artifactId:'a'.repeat(32)});workspace.setWorkspacePin({kind:'tool',tab:'browser'});});
  expect([...document.querySelectorAll('section:not([hidden])')].map(node=>node.dataset.tab)).toEqual(['generate','browser']);
  state.activeSidebarTab='browser';await render();
  expect(workspace.workspacePin).toBeNull();
  await act(async()=>workspace.setWorkspacePin({kind:'tool',tab:'chats'}));
  state.activeSidebarTab='generate';await render();
  expect(workspace.workspacePin).toEqual({kind:'tool',tab:'browser'});
  expect(document.querySelector('[data-tab="generate"] textarea')).toBe(draft);
  expect(draft.value).toBe('Unsaved prompt');
  expect(workspace.pin).toEqual({kind:'document',artifactId:'a'.repeat(32)});
  expect(JSON.parse(values.get(WORKSPACE_PINS_KEY))).toEqual({generate:{kind:'tool',tab:'browser'},browser:{kind:'tool',tab:'chats'}});
  expect(JSON.parse(values.get(CHAT_PINS_KEY))['saved-chat']).toEqual(workspace.pin);
  await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await render();
  expect(workspace.workspacePin).toEqual({kind:'tool',tab:'browser'});
  expect(workspace.pin.kind).toBe('document');
  await act(async()=>workspace.setWorkspacePin(null));
  expect(workspace.workspacePin).toBeNull();
  expect(workspace.pin.kind).toBe('document');
  expect(JSON.parse(values.get(WORKSPACE_PINS_KEY)).browser).toEqual({kind:'tool',tab:'chats'});
});
it('keeps pairs usable and reports storage failure when selections cannot be saved',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw Error('denied');}});
  await render();await act(async()=>workspace.setWorkspacePin({kind:'tool',tab:'browser'}));
  expect(workspace.workspacePin.tab).toBe('browser');
  expect(workspace.workspaceStorageError).toContain('could not be remembered');
  expect([...document.querySelectorAll('[aria-label="Side pane workspace"] option')].some(node=>node.value==='generate')).toBe(false);
});
