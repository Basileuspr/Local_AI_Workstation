import FaceBank from './FaceBank';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import './FaceStudio.css';
import './CharacterCreator.css';
import {useDispatch} from '../useStore';

export default function CharacterCreator({active}) {
  const workspace = useCharacterWorkspace();
  const dispatch=useDispatch();
  return <section className="face-studio character-creator" aria-label="Character Creator">
    <header className="face-header"><div><p className="face-eyebrow">Character profiles</p><h1>Character Creator</h1></div>
      <div className="face-row"><button type="button" onClick={() => workspace.onNavigate('faces')}>Open Face Extractor</button><button type="button" onClick={() => workspace.onNavigate('audio')}>Open Audio</button><button type="button" onClick={() => workspace.onNavigate('packager')}>Open Packager</button></div>
    </header>
    <FaceBank active={active} initialId={workspace.selected?.id} openCharacter={workspace.target} onSelectCharacter={workspace.select}
      onLoadRoleplay={character=>{dispatch({type:'LOAD_ROLEPLAY_CHARACTER',payload:character});workspace.onNavigate('chats');}}
      onOpenExtractor={() => workspace.onNavigate('faces')} onStartKnowledge={id => workspace.openKnowledge(id)}/>
  </section>;
}
