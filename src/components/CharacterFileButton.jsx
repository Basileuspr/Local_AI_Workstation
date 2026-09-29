import {useRef,useState} from 'react';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import {attachCharacterFile,editResource} from '../characterResources';

export default function CharacterFileButton({file,note,label='file',disabled=false}) {
  const workspace=useCharacterWorkspace(),lock=useRef(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  if(!workspace?.selected || !file)return null;
  async function save(){
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    const character=workspace.selected;
    try{
      const link=await attachCharacterFile(character.id,file,note||'');
      if(note!==undefined && link.note!==note)await editResource(character.id,link.id,note);
      setMessage(`Saved to ${character.name}.`);
    }
    catch(e){setMessage(e.message);}
    finally{lock.current=false;setBusy(false);}
  }
  return <span className="character-file-save"><button type="button" title={file.name} disabled={disabled||busy} onClick={save}>{busy?'Saving to character…':`Save ${label} to ${workspace.selected.name}`}</button>{message&&<small role="status">{message}</small>}</span>;
}
