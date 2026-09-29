import {useState} from 'react';
import {useStore,useDispatch} from '../useStore';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import {chatInfluences} from '../chatInfluences';
import {getCharacter} from '../faceApi';
import './ChatInfluences.css';

export default function ChatInfluences(){
  const state=useStore(),dispatch=useDispatch(),workspace=useCharacterWorkspace();
  const plan=chatInfluences(state),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const roleplay=plan.summary.roleplay;
  async function loadSelected(){
    if(busy)return;setBusy(true);setError('');
    try{dispatch({type:'LOAD_ROLEPLAY_CHARACTER',payload:await getCharacter(workspace.selected.id)});}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const setField=(key,value)=>dispatch({type:'SET_ROLEPLAY_FIELD',key,value});
  return <details className="chat-influences">
    <summary>Response influences · {roleplay?`Roleplay: ${roleplay.name}`:'Roleplay off'} · Knowledge {plan.summary.knowledge} · Saved memories {plan.useDurableMemory?'on':'off'}{plan.warnings.length>0?` · ${plan.warnings.length} potential overlap${plan.warnings.length===1?'':'s'}`:''}</summary>
    <p><strong>Next submitted message.</strong> Prompt and roleplay settings apply across chats until changed. Each reply keeps its own request record below. Queued messages retain the settings selected when sent.</p>
    <dl><dt>Chat model</dt><dd>{state.selectedModel||'None selected'}</dd>
      <dt>Roleplay source</dt><dd>{roleplay?(roleplay.source?`Saved character: ${roleplay.source.name}${roleplay.source.edited?' · roleplay fields edited since loading':''} · loaded ${new Date(roleplay.source.loadedAt).toLocaleString()}`:'Manual roleplay fields / preset'):'Not included'}</dd>
      <dt>General system prompt</dt><dd>{plan.summary.generalPrompt?'Included':'Not included'}</dd>
      <dt>Response style</dt><dd>{plan.summary.responseStyle||'Not included'}</dd>
      <dt>Knowledge retrieval</dt><dd>{plan.summary.knowledge==='selected'?`${state.knowledgeDocIds?.length||0} selected documents`:plan.summary.knowledge}. Retrieved excerpts are confirmed per reply.</dd>
      <dt>Conversation</dt><dd>Recent messages{state.memorySummary?' and the rolling chat summary':''} remain eligible, including earlier character dialogue and uploaded document text. Automatic compaction can replace older messages with a summary.</dd>
    </dl>
    {workspace?.selected&&<p>Character Creator selection: <strong>{workspace.selected.name}</strong>. Browsing a profile alone does not load it into chat. <button type="button" disabled={busy} onClick={loadSelected}>Load {workspace.selected.name} into roleplay</button></p>}
    <p>Loading a character replaces roleplay fields with its saved name, biography, and notes. Linked images, videos, audio, parts, and LoRAs are not automatically sent to the chat model. Voice playback settings do not change these text instructions.</p>
    {roleplay&&<div className="influence-controls">
      <label><input type="checkbox" checked={state.roleplay.includeGeneralPrompt!==false} onChange={e=>setField('includeGeneralPrompt',e.target.checked)}/>Include general system prompt</label>
      <label><input type="checkbox" checked={state.roleplay.includeResponseStyle!==false} onChange={e=>setField('includeResponseStyle',e.target.checked)}/>Include general response style</label>
      <label><input type="checkbox" checked={plan.useDurableMemory} onChange={e=>setField('useDurableMemory',e.target.checked)}/>Use saved user memories</label>
      <button type="button" onClick={()=>setField('enabled',false)}>Turn roleplay off</button>
    </div>}
    {plan.warnings.length>0&&<ul className="influence-warnings">{plan.warnings.map(value=><li key={value}>{value}</li>)}</ul>}
    {roleplay&&state.conversationHistory.length>0&&<p>For a clean character change, start a new chat. Turning off roleplay or saved memories does not remove earlier dialogue or the rolling summary.</p>}
    <div className="influence-controls"><button type="button" onClick={()=>dispatch({type:'SET_SETTINGS_OPEN',payload:true})}>Edit chat / roleplay settings</button>{state.useKnowledgeBase&&<button type="button" onClick={()=>dispatch({type:'SET_KNOWLEDGE_SCOPE',payload:{mode:'off',ids:[]}})}>Turn Knowledge off for this chat</button>}</div>
    <details><summary>Preview assembled chat instructions</summary>{plan.parts.map(part=><section key={part.name}><strong>{part.name}</strong><pre>{part.text}</pre></section>)}</details>
    <p>These controls show app-supplied context. The model’s training and built-in template also affect its response; the app cannot measure how much each input influenced the wording.</p>
    {error&&<p role="alert">{error}</p>}
  </details>;
}

export function ReplyInfluences({message}){
  const actual=message.influence_receipt,configured=message.influence_settings;
  if(!actual)return <details className="reply-influences"><summary>Response influences · not recorded</summary><p>This reply has no backend request record. Current chat settings cannot tell us exactly what was supplied for it.</p></details>;
  const local=actual.mode==='image_conversion';
  return <details className="reply-influences"><summary>Response influences · {local?'local conversion':`${configured?.roleplay?.name?configured.roleplay.name+' · ':''}${actual.model||'model request'}`}</summary>
    {local?<p>Local image conversion. No chat model, roleplay prompt, or retrieved context was used.</p>:<>
      <p>Request assembled {new Date(actual.prepared_at).toLocaleString()} for this reply. This records app inputs, not proof that the model followed every source. Provider errors may mean the request was not processed.</p>
      {configured&&<p>At Send: {configured.roleplay?`Roleplay ${configured.roleplay.name}`:'Roleplay off'}; general prompt {configured.generalPrompt?'included':'off'}; style {configured.responseStyle||'off'}.</p>}
      <p>Saved user memories: <strong>{actual.durable_memory?.status||'not recorded'}</strong>. Knowledge: <strong>{actual.knowledge?.status||'not recorded'}</strong> ({actual.knowledge?.mode||'unknown'} scope).</p>
      {actual.knowledge?.sources?.length>0&&<ul>{actual.knowledge.sources.map((source,index)=><li key={index}>{source.filename} · excerpt {source.chunk_index+1} · {source.characters} characters</li>)}</ul>}
      {(actual.notices||[]).map((notice,index)=><p key={index}>{notice.message}</p>)}
      <p>{actual.message_count} messages and {actual.image_count} image inputs in the model request. {actual.structured_output?'Structured output was required. ':''}Message order is shown below; it is not a guarantee of which conflicting instruction wins.</p>
      <details><summary>Effective model options</summary><pre>{JSON.stringify({model:actual.model,...actual.options,think:actual.think},null,2)}</pre></details>
      <details><summary>Instructions and context in request order</summary>{actual.messages?.map(item=><section key={item.position}>
        <strong>{item.position}. {item.label} ({item.role})</strong><small>{item.characters} characters · {item.images} images{item.truncated?' · excerpt shown':''}</small>
        <pre>{item.text||'(No text)'}</pre>{item.truncated&&<small>Full text fingerprint: {item.sha256}</small>}
      </section>)}{actual.omitted_messages>0&&<p>{actual.omitted_messages} additional messages are not expanded in this bounded record.</p>}</details>
    </>}
  </details>;
}
