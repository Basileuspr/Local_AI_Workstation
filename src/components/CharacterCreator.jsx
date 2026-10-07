import FaceBank from './FaceBank';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import './FaceStudio.css';
import './CharacterCreator.css';
import {useDispatch} from '../useStore';
import ActionMenu from './ActionMenu';

export default function CharacterCreator({active}) {
  const workspace = useCharacterWorkspace();
  const dispatch=useDispatch();
  return <section className="face-studio character-creator" aria-label="Character Creator">
    <header className="face-header"><div><p className="face-eyebrow">Character profiles</p><h1>Character Creator</h1></div>
      <ActionMenu label="Related tools" actions={[
        {label:'Open Face Extractor', onClick:() => workspace.onNavigate('faces')},
        {label:'Open Audio', onClick:() => workspace.onNavigate('audio')},
        {label:'Open Packager', onClick:() => workspace.onNavigate('packager')},
      ]}/>
    </header>
    <FaceBank active={active} initialId={workspace.selected?.id} openCharacter={workspace.target} onSelectCharacter={workspace.select}
      onLoadRoleplay={character=>{dispatch({type:'LOAD_ROLEPLAY_CHARACTER',payload:character});workspace.onNavigate('chats');}}
      onOpenExtractor={() => workspace.onNavigate('faces')} onStartKnowledge={id => workspace.openKnowledge(id)}/>
  </section>;
}
