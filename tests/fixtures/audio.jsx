import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AudioWorkspace, {ChatAudio, ReadAloud} from '../../src/components/AudioWorkspace';

function Fixture() {
  const [active,setActive]=useState(true), [draft,setDraft]=useState('Existing draft');
  return <><button onClick={()=>setActive(!active)}>Switch workspace</button><div hidden={!active}><AudioWorkspace active={active}/></div><div hidden={active}><ChatAudio active={!active} sessionId="fixture" onInsert={text=>setDraft(value=>value+'\n'+text)}/><textarea aria-label="Chat draft" value={draft} onChange={e=>setDraft(e.target.value)}/><ReadAloud text="This is a local voice test." owner="qa-chat" active={!active}/></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
