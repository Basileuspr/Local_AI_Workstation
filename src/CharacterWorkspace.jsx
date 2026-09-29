import {createContext,useCallback,useContext,useState} from 'react';

const Context = createContext(null);
const KEY = 'law-selected-character-v1';
export function CharacterWorkspaceProvider({onNavigate,onOpenDestination,children}) {
  const [selected,setSelected] = useState(() => {
    try {const saved = JSON.parse(localStorage.getItem(KEY)); return /^[a-f0-9]{32}$/.test(saved?.id) && typeof saved.name === 'string' ? {id:saved.id,name:saved.name} : null;} catch {return null;}
  });
  const [target,setTarget] = useState(null), [knowledgeTarget,setKnowledgeTarget] = useState(null);
  const [documentTarget,setDocumentTarget] = useState(null);
  const [voiceTarget,setVoiceTarget] = useState(null);
  const select = useCallback(character => {
    const value = character ? {id:character.id,name:character.name} : null;
    setSelected(value);
    try {value ? localStorage.setItem(KEY,JSON.stringify(value)) : localStorage.removeItem(KEY);} catch { /* Navigation still works. */ }
  },[]);
  function openCreator(id = selected?.id, {refresh = false} = {}) {
    setTarget({id:id || '',refresh,request:crypto.randomUUID()});onNavigate('characters');
  }
  function openKnowledge(id = selected?.id) {
    setKnowledgeTarget({id:id || '',request:crypto.randomUUID()});onNavigate('knowledge');
  }
  function openResource(item) {
    if(item.kind==='character')return openCreator(item.target_id);
    if(item.kind==='knowledge'){setDocumentTarget({id:item.target_id,request:crypto.randomUUID()});return onNavigate('knowledge');}
    if(item.kind==='parts')return onOpenDestination?.({tab:'character-parts',datasetId:item.target_id});
    if(item.kind==='lora_project')return onOpenDestination?.({tab:'lora',projectId:item.target_id});
    if(item.kind==='lora_adapter')return onNavigate('lora');
    if(item.kind==='image')return onNavigate('library');
  }
  function openVoice(item){setVoiceTarget({...item,request:crypto.randomUUID()});onNavigate('audio');}
  return <Context.Provider value={{selected,select,target,knowledgeTarget,documentTarget,voiceTarget,openVoice,openCreator,openKnowledge,openResource,onNavigate}}>{children}</Context.Provider>;
}
export const useCharacterWorkspace = () => useContext(Context);

export function CharacterShortcut() {
  const workspace = useCharacterWorkspace();
  if (!workspace) return null;
  return <div className="character-shortcut"><button type="button" onClick={() => workspace.openCreator()}>Open Character Creator</button>{workspace.selected && <span>Selected character: {workspace.selected.name}</span>}</div>;
}
